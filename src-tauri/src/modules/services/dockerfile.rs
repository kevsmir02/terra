// Verify against the current PHP release train before shipping, then bump per
// Terra release rather than tracking a floating tag.
pub const PHP_TAG: &str = "8.5-fpm-alpine";
const EXT_INSTALLER: &str = "mlocati/php-extension-installer:2.11.12";
const EXTENSIONS: &str =
    "pdo_mysql pdo_pgsql mbstring bcmath intl zip gd exif pcntl opcache redis";

pub fn render_php_dockerfile() -> String {
    format!(
        "FROM php:{PHP_TAG}\n\
         COPY --from={EXT_INSTALLER} /usr/bin/install-php-extensions /usr/local/bin/\n\
         RUN install-php-extensions {EXTENSIONS}\n\
         COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer\n\
         COPY terra-dev.ini /usr/local/etc/php/conf.d/terra-dev.ini\n\
         WORKDIR /sites\n"
    )
}

pub fn render_dev_ini() -> String {
    "opcache.enable=1\n\
     opcache.validate_timestamps=1\n\
     opcache.revalidate_freq=0\n\
     display_errors=On\n\
     error_reporting=E_ALL\n\
     upload_max_filesize=64M\n\
     post_max_size=64M\n"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_every_extension_laravel_needs() {
        let out = render_php_dockerfile();
        for ext in ["pdo_mysql", "pdo_pgsql", "mbstring", "bcmath", "intl", "zip", "gd", "redis"] {
            assert!(out.contains(ext), "missing extension {ext}");
        }
    }

    #[test]
    fn ships_composer_and_the_dev_ini() {
        let out = render_php_dockerfile();
        assert!(out.contains("COPY --from=composer:2"));
        assert!(out.contains("terra-dev.ini"));
    }

    #[test]
    fn the_dev_ini_makes_edits_visible_on_the_next_request() {
        let ini = render_dev_ini();
        assert!(ini.contains("opcache.validate_timestamps=1"));
        assert!(ini.contains("opcache.revalidate_freq=0"));
    }

    #[test]
    fn every_image_reference_is_pinned() {
        let out = render_php_dockerfile();
        assert!(!out.contains(":latest"));
        for line in out.lines().filter(|l| l.starts_with("FROM ") || l.contains("--from=")) {
            assert!(line.contains(':'), "unpinned image reference: {line}");
        }
    }
}
