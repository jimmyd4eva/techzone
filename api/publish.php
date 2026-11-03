<?php
declare(strict_types=1);

/*
  TechZone publish endpoint.

  GET  api/publish.php?page=index.html   → published edits for that page
  POST api/publish.php                   → {action:"publish", page, pass, edits}
  POST api/publish.php                   → {action:"clear", page, pass}
*/

require __DIR__ . '/media-storage.php';

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

const PAGES = ['index.html', 'shop.html', 'software.html', 'about.html', 'contact.html', 'affiliate.html'];
const SALT_HEX = '301f253b53ebfab900378d30fc9c0c7e';
const HASH_HEX = 'fb45526f55ca84633bcf5a84e43e8b808d0deece3b74f48f83f94a41d36a121d';
const ITERATIONS = 310000;
const MAX_BODY = 6000000;
const MAX_IMAGE_BYTES = 3000000;
const MAX_TEXT = 200000;
const MAX_ENTRIES = 2000;
const MAX_PRODUCTS = 60;
const PRODUCT_CATEGORIES = ['computer', 'computer-accessories', 'cellphones', 'cellphone-accessories', 'cellphone-parts', 'jewelry-perfume', 'random-stuff'];
const THROTTLE_ATTEMPTS = 20;
const THROTTLE_WINDOW = 600;

$root = dirname(__DIR__);
$dataDir = $root . '/data/published';
$imgDir = $dataDir . '/img';
$oldImgDir = $root . '/assets/img/published';

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $message): void
{
    respond($status, ['ok' => false, 'error' => $message]);
}

function page_base(string $page): string
{
    return substr($page, 0, -5);
}

function same_page(array $body, string $page): bool
{
    if (!isset($body['page']) || !is_string($body['page'])) {
        return false;
    }
    return basename($body['page']) === $page;
}

function ensure_dir(string $dir): void
{
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail(500, 'The site could not create its data folder.');
    }
}

function guard_dir(string $dir): void
{
    $guard = $dir . '/.htaccess';
    if (!is_file($guard)) {
        @file_put_contents(
            $guard,
            "Options -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n"
        );
    }
}

function read_json(string $file): ?array
{
    if (!is_file($file)) {
        return null;
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function write_json(string $file, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        fail(500, 'The edits could not be encoded.');
    }
    $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        fail(500, 'The site could not write the edits file.');
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        fail(500, 'The site could not replace the edits file.');
    }
    @chmod($file, 0644);
}

function same_origin(): bool
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return true;
    }
    $parts = parse_url($origin);
    if (!is_array($parts) || !isset($parts['host'], $parts['scheme'])) {
        return false;
    }
    if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        return false;
    }
    $originHost = strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    $selfHost = strtolower($_SERVER['HTTP_HOST'] ?? '');
    return $originHost === $selfHost;
}

function throttle_file(string $dataDir): string
{
    return $dataDir . '/.throttle.json';
}

function throttle_check(string $dataDir): void
{
    $file = throttle_file($dataDir);
    $state = read_json($file) ?: [];
    $now = time();
    $key = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $entry = $state[$key] ?? null;
    if (is_array($entry) && ($now - (int) ($entry['t'] ?? 0)) < THROTTLE_WINDOW && (int) ($entry['n'] ?? 0) >= THROTTLE_ATTEMPTS) {
        fail(429, 'Too many attempts. Wait a few minutes and try again.');
    }
}

function throttle_hit(string $dataDir): void
{
    $file = throttle_file($dataDir);
    $state = read_json($file) ?: [];
    $now = time();
    $key = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    foreach ($state as $k => $v) {
        if (!is_array($v) || ($now - (int) ($v['t'] ?? 0)) >= THROTTLE_WINDOW) {
            unset($state[$k]);
        }
    }
    $entry = $state[$key] ?? ['t' => $now, 'n' => 0];
    if (($now - (int) $entry['t']) >= THROTTLE_WINDOW) {
        $entry = ['t' => $now, 'n' => 0];
    }
    $entry['n'] = (int) $entry['n'] + 1;
    $state[$key] = $entry;
    @file_put_contents($file, json_encode($state), LOCK_EX);
}

function check_pass(string $given): bool
{
    $salt = hex2bin(SALT_HEX);
    $expected = hex2bin(HASH_HEX);
    $calc = hash_pbkdf2('sha256', $given, $salt, ITERATIONS, 32, true);
    return hash_equals($expected, $calc);
}

function clean_text_map($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    $count = 0;
    foreach ($value as $key => $text) {
        if (!is_string($key) || !is_string($text) || strlen($key) > 200 || strlen($text) > MAX_TEXT) {
            continue;
        }
        $out[$key] = $text;
        if (++$count >= MAX_ENTRIES) {
            break;
        }
    }
    return $out;
}

function clean_link_map($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    $count = 0;
    foreach ($value as $key => $href) {
        if (!is_string($key) || !is_string($href) || strlen($key) > 200 || strlen($href) > 2000) {
            continue;
        }
        $href = trim($href);
        if ($href === '' || preg_match('#^\s*javascript:#i', $href)) {
            continue;
        }
        $out[$key] = $href;
        if (++$count >= MAX_ENTRIES) {
            break;
        }
    }
    return $out;
}

function clean_removed_map($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    $count = 0;
    foreach ($value as $key => $flag) {
        if (!is_string($key) || strlen($key) > 200 || !$flag) {
            continue;
        }
        $out[$key] = true;
        if (++$count >= MAX_ENTRIES) {
            break;
        }
    }
    return $out;
}

function store_image(string $dataUrl, string $base, string $key, string $imgDir): ?string
{
    if (!preg_match('#^data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$#s', $dataUrl, $match)) {
        return null;
    }
    $raw = base64_decode(preg_replace('/\s+/', '', $match[2]), true);
    if ($raw === false || $raw === '' || strlen($raw) > MAX_IMAGE_BYTES) {
        return null;
    }
    $info = @getimagesizefromstring($raw);
    if (!is_array($info)) {
        return null;
    }
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!isset($types[$info[2]])) {
        return null;
    }
    $name = $base . '-' . substr(hash('sha256', $key . '|' . $raw), 0, 16) . '.' . $types[$info[2]];
    ensure_dir($imgDir);
    if (@file_put_contents($imgDir . '/' . $name, $raw, LOCK_EX) === false) {
        fail(500, 'A replacement photo could not be saved.');
    }
    @chmod($imgDir . '/' . $name, 0644);
    return 'api/media.php?f=' . $name;
}

function stored_name(string $src): ?string
{
    return preg_match('#^api/media\.php\?f=([A-Za-z0-9][A-Za-z0-9._-]*)$#', $src, $m)
        ? $m[1]
        : null;
}

function restore_image(string $name, string $imgDir, string $backupDir): bool
{
    if ($backupDir === '' || !is_file($backupDir . '/' . $name)) {
        return false;
    }
    ensure_dir($imgDir);
    if (!@copy($backupDir . '/' . $name, $imgDir . '/' . $name)) {
        return false;
    }
    @chmod($imgDir . '/' . $name, 0644);
    return true;
}

function resolve_stored_image(string $src, string $imgDir, string $oldImgDir, string $backupDir): ?string
{
    $name = stored_name($src);
    if ($name !== null) {
        if (is_file($imgDir . '/' . $name) || restore_image($name, $imgDir, $backupDir)) {
            return 'api/media.php?f=' . $name;
        }
        return null;
    }
    if (preg_match('#^assets/img/published/([A-Za-z0-9][A-Za-z0-9._-]*)$#', $src, $m)) {
        $name = $m[1];
        if (is_file($imgDir . '/' . $name) || restore_image($name, $imgDir, $backupDir)) {
            return 'api/media.php?f=' . $name;
        }
        if (is_file($oldImgDir . '/' . $name)) {
            ensure_dir($imgDir);
            if (@copy($oldImgDir . '/' . $name, $imgDir . '/' . $name)) {
                @chmod($imgDir . '/' . $name, 0644);
                return 'api/media.php?f=' . $name;
            }
        }
        return null;
    }
    if (
        strlen($src) <= 500 &&
        strpos($src, '..') === false &&
        preg_match('#^[A-Za-z0-9][A-Za-z0-9._~\-/]*$#', $src)
    ) {
        return $src;
    }
    return null;
}

function mirror_images(array $edits, string $imgDir, string $backupDir): void
{
    if ($backupDir === '') {
        return;
    }
    $names = [];
    foreach (($edits['images'] ?? []) as $src) {
        $name = is_string($src) ? stored_name($src) : null;
        if ($name !== null) {
            $names[$name] = true;
        }
    }
    foreach (($edits['products'] ?? []) as $product) {
        if (!is_array($product) || !isset($product['image']) || !is_string($product['image'])) {
            continue;
        }
        $name = stored_name($product['image']);
        if ($name !== null) {
            $names[$name] = true;
        }
    }
    foreach (array_keys($names) as $name) {
        $from = $imgDir . '/' . $name;
        $to = $backupDir . '/' . $name;
        if (!is_file($from)) {
            continue;
        }
        if (is_file($to) && filesize($to) === filesize($from)) {
            continue;
        }
        if (@copy($from, $to)) {
            @chmod($to, 0644);
        }
    }
}

function clean_image_map($value, string $base, string $imgDir, string $oldImgDir, string $backupDir): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    $count = 0;
    foreach ($value as $key => $src) {
        if (!is_string($key) || !is_string($src) || strlen($key) > 200) {
            continue;
        }
        if (strpos($src, 'data:image/') === 0) {
            $stored = store_image($src, $base, $key, $imgDir);
            if ($stored === null) {
                fail(422, 'That photo could not be included. Use a JPG, PNG, WebP or GIF under 3 MB.');
            }
            $src = $stored;
        } else {
            $kept = resolve_stored_image($src, $imgDir, $oldImgDir, $backupDir);
            if ($kept === null) {
                continue;
            }
            $src = $kept;
        }
        $out[$key] = $src;
        if (++$count >= MAX_ENTRIES) {
            break;
        }
    }
    return $out;
}

function clean_product_list($value, string $base, string $imgDir, string $oldImgDir, string $backupDir): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    $seen = [];
    foreach ($value as $item) {
        if (count($out) >= MAX_PRODUCTS) {
            break;
        }
        if (!is_array($item)) {
            continue;
        }
        $id = isset($item['id']) && is_string($item['id']) ? strtolower(trim($item['id'])) : '';
        if (!preg_match('/^p-[a-z0-9]{4,24}$/', $id) || isset($seen[$id])) {
            continue;
        }
        $name = isset($item['name']) && is_string($item['name']) ? trim($item['name']) : '';
        $name = trim((string) preg_replace('/[\x00-\x1F\x7F]+/', ' ', $name));
        if ($name === '' || strlen($name) > 200) {
            continue;
        }
        $price = isset($item['price']) && is_numeric($item['price']) ? (float) $item['price'] : 0.0;
        if (!is_finite($price) || $price <= 0 || $price > 1000000) {
            continue;
        }
        $qty = 0;
        if (array_key_exists('qty', $item)) {
            $qty = filter_var($item['qty'], FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 9999],
            ]);
            if ($qty === false) {
                continue;
            }
        }
        $category = isset($item['category']) && is_string($item['category']) ? $item['category'] : '';
        if (!in_array($category, PRODUCT_CATEGORIES, true)) {
            continue;
        }
        $description = isset($item['description']) && is_string($item['description']) ? trim($item['description']) : '';
        $description = trim((string) preg_replace('/[\x00-\x1F\x7F]+/', ' ', $description));
        if (strlen($description) > 400) {
            $description = substr($description, 0, 400);
        }
        $href = isset($item['href']) && is_string($item['href']) ? trim($item['href']) : '';
        if ($href === '' || strlen($href) > 2000 || preg_match('#^\s*javascript:#i', $href)) {
            $href = 'contact.html?product=' . rawurlencode($name);
        }
        $image = '';
        if (isset($item['image']) && is_string($item['image']) && $item['image'] !== '') {
            $src = $item['image'];
            if (strpos($src, 'data:image/') === 0) {
                $stored = store_image($src, $base . '-p', $id, $imgDir);
                $image = $stored === null ? '' : $stored;
            } else {
                $image = resolve_stored_image($src, $imgDir, $oldImgDir, $backupDir) ?? '';
            }
        }
        $seen[$id] = true;
        $out[] = [
            'id' => $id,
            'name' => $name,
            'price' => round($price, 2),
            'category' => $category,
            'description' => $description,
            'qty' => $qty,
            'image' => $image,
            'href' => $href,
        ];
    }
    return $out;
}

function clean_unused_product_images(array $products, string $base, string $imgDir): void
{
    $keep = [];
    foreach ($products as $product) {
        if (!isset($product['image']) || !is_string($product['image']) || $product['image'] === '') {
            continue;
        }
        if (preg_match('#^api/media\.php\?f=([A-Za-z0-9][A-Za-z0-9._-]*)$#', $product['image'], $m)) {
            $keep[$m[1]] = true;
        } else {
            $keep[basename($product['image'])] = true;
        }
    }
    foreach (glob($imgDir . '/' . $base . '-p-*') ?: [] as $file) {
        if (is_file($file) && !isset($keep[basename($file)])) {
            @unlink($file);
        }
    }
}

if (!same_origin()) {
    fail(403, 'This request came from another site.');
}

$page = isset($_GET['page']) ? basename((string) $_GET['page']) : 'index.html';
if (!in_array($page, PAGES, true)) {
    $page = 'index.html';
}
$base = page_base($page);
$file = $dataDir . '/' . $base . '.json';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $data = read_json($file);
    if ($data === null) {
        respond(200, ['ok' => true, 'page' => $page, 'empty' => true, 'edits' => null]);
    }
    respond(200, ['ok' => true, 'page' => $page, 'empty' => false, 'edits' => $data]);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'Unsupported method.');
}

$type = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
if (strpos($type, 'application/json') === 0) {
    // fine
} else {
    fail(415, 'Expected a JSON body.');
}

ensure_dir($dataDir);
guard_dir($dataDir);
throttle_check($dataDir);

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    fail(400, 'The request was empty.');
}
if (strlen($raw) > MAX_BODY) {
    fail(413, 'These edits are too large to publish at once. Publish the photos one at a time.');
}

$body = json_decode($raw, true);
if (!is_array($body)) {
    fail(400, 'The request was not valid JSON.');
}
if (!same_page($body, $page)) {
    fail(400, 'The page in the request did not match.');
}
$pass = isset($body['pass']) && is_string($body['pass']) ? $body['pass'] : '';
if ($pass === '' || !check_pass($pass)) {
    throttle_hit($dataDir);
    fail(401, 'That passphrase was not accepted. Nothing was published.');
}

$action = isset($body['action']) ? (string) $body['action'] : 'publish';

if ($action === 'clear') {
    if (is_file($file)) {
        @unlink($file);
    }
    foreach ([$imgDir, $oldImgDir] as $dir) {
        foreach (glob($dir . '/' . $base . '-*') ?: [] as $old) {
            if (is_file($old)) {
                @unlink($old);
            }
        }
    }
    respond(200, ['ok' => true, 'page' => $page, 'cleared' => true]);
}

if ($action !== 'publish') {
    fail(400, 'Unknown action.');
}

$incoming = isset($body['edits']) && is_array($body['edits']) ? $body['edits'] : null;
if ($incoming === null) {
    fail(400, 'No edits were sent.');
}

$backupDir = media_backup_dir($root, true);

$edits = [
    'v' => 1,
    'page' => $page,
    'updated' => gmdate('c'),
    'text' => clean_text_map($incoming['text'] ?? []),
    'images' => clean_image_map($incoming['images'] ?? [], $base, $imgDir, $oldImgDir, $backupDir),
    'links' => clean_link_map($incoming['links'] ?? []),
    'removed' => clean_removed_map($incoming['removed'] ?? []),
    'removedImages' => clean_removed_map($incoming['removedImages'] ?? []),
    'products' => $page === 'shop.html'
        ? clean_product_list($incoming['products'] ?? [], $base, $imgDir, $oldImgDir, $backupDir)
        : [],
];

write_json($file, $edits);
if ($page === 'shop.html') {
    clean_unused_product_images($edits['products'], $base, $imgDir);
}
mirror_images($edits, $imgDir, $backupDir);
respond(200, ['ok' => true, 'page' => $page, 'edits' => $edits]);
