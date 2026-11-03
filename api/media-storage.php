<?php
declare(strict_types=1);

/*
  Backup location for photos published through api/publish.php.

  The primary copy lives in data/published/img. This mirror sits outside
  public_html so a deploy that replaces the site tree cannot remove it.
  If the parent folder is not writable, fall back to data/backups.
*/

function media_backup_dir(string $root, bool $create): string
{
    $candidates = [
        dirname($root) . '/techzone-photo-backup',
        $root . '/data/backups',
    ];
    foreach ($candidates as $dir) {
        if (!is_dir($dir)) {
            if (!$create || (!@mkdir($dir, 0775, true) && !is_dir($dir))) {
                continue;
            }
            media_guard_dir($dir);
        }
        if (is_writable($dir)) {
            return $dir;
        }
    }
    return '';
}

function media_guard_dir(string $dir): void
{
    $guard = $dir . '/.htaccess';
    if (!is_file($guard)) {
        @file_put_contents(
            $guard,
            "Options -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n"
        );
    }
}
