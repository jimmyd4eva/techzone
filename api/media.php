<?php
declare(strict_types=1);

/*
  Serves photos published through api/publish.php.

  They live under data/published/img so Git deployments (which replace
  tracked asset folders) cannot delete them. A mirror outside the site
  tree restores a missing photo after a deploy that replaces everything.
*/

require __DIR__ . '/media-storage.php';

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

$root = dirname(__DIR__);
$primaryDir = $root . '/data/published/img';
$path = $primaryDir . '/' . $name;
$backupDir = media_backup_dir($root, false);

if (!is_file($path) && $backupDir !== '') {
    $backupPath = $backupDir . '/' . $name;
    if (is_file($backupPath)) {
        if (!is_dir($primaryDir) && !@mkdir($primaryDir, 0775, true) && !is_dir($primaryDir)) {
            $path = $backupPath;
        } else {
            @copy($backupPath, $path);
            if (is_file($path)) {
                @chmod($path, 0644);
            } else {
                $path = $backupPath;
            }
        }
    }
}

if (!is_file($path)) {
    http_response_code(404);
    exit;
}

if ($path === $primaryDir . '/' . $name) {
    if ($backupDir === '') {
        $backupDir = media_backup_dir($root, true);
    }
    if ($backupDir !== '') {
        $backupPath = $backupDir . '/' . $name;
        if (!is_file($backupPath) && @copy($path, $backupPath)) {
            @chmod($backupPath, 0644);
        }
    }
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
