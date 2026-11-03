<?php
declare(strict_types=1);

/*
  Serves photos published through api/publish.php.

  They live under data/published/img so Git deployments (which replace
  tracked asset folders) cannot delete them.
*/

$name = isset($_GET['f']) ? (string) $_GET['f'] : '';

if (
    $name === '' ||
    strlen($name) > 170 ||
    strpos($name, '..') !== false ||
    !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|gif)$/i', $name)
) {
    http_response_code(404);
    exit;
}

$path = dirname(__DIR__) . '/data/published/img/' . $name;

if (!is_file($path)) {
    http_response_code(404);
    exit;
}

$info = @getimagesize($path);
$types = [
    IMAGETYPE_JPEG => 'image/jpeg',
    IMAGETYPE_PNG => 'image/png',
    IMAGETYPE_WEBP => 'image/webp',
    IMAGETYPE_GIF => 'image/gif',
];

if (!is_array($info) || !isset($types[$info[2]])) {
    http_response_code(404);
    exit;
}

header('Content-Type: ' . $types[$info[2]]);
header('Content-Length: ' . (string) filesize($path));
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($path);
