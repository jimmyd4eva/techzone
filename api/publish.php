<?php
declare(strict_types=1);

/*
  TechZone publish endpoint.

  GET  api/publish.php?page=index.html   → published edits for that page
  POST api/publish.php                   → {action:"publish", page, pass, edits}
  POST api/publish.php                   → {action:"clear", page, pass}
*/

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
const THROTTLE_ATTEMPTS = 20;
const THROTTLE_WINDOW = 600;

$root = dirname(__DIR__);
$dataDir = $root . '/data/published';
$imgDir = $root . '/assets/img/published';

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
    return 'assets/img/published/' . $name;
}

function clean_image_map($value, string $base, string $imgDir): array
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
                fail(422, 'A replacement photo could not be processed. Try a JPG or PNG.');
            }
            $src = $stored;
        } elseif (
            strlen($src) > 500 ||
            strpos($src, '..') !== false ||
            !preg_match('#^[A-Za-z0-9][A-Za-z0-9._~\-/]*$#', $src)
        ) {
            continue;
        }
        $out[$key] = $src;
        if (++$count >= MAX_ENTRIES) {
            break;
        }
    }
    return $out;
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
    foreach (glob($imgDir . '/' . $base . '-*') ?: [] as $old) {
        if (is_file($old)) {
            @unlink($old);
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

$edits = [
    'v' => 1,
    'page' => $page,
    'updated' => gmdate('c'),
    'text' => clean_text_map($incoming['text'] ?? []),
    'images' => clean_image_map($incoming['images'] ?? [], $base, $imgDir),
    'links' => clean_link_map($incoming['links'] ?? []),
    'removed' => clean_removed_map($incoming['removed'] ?? []),
    'removedImages' => clean_removed_map($incoming['removedImages'] ?? []),
];

write_json($file, $edits);
respond(200, ['ok' => true, 'page' => $page, 'edits' => $edits]);
