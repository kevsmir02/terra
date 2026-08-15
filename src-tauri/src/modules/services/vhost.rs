use std::collections::BTreeSet;
use std::fmt::Write as _;

use super::catalog;
use super::spec::{SiteKind, SiteSpec};

const FIRST_SITE_PORT: u16 = 8000;

pub fn assign_port(taken: &BTreeSet<u16>) -> u16 {
    let reserved: BTreeSet<u16> = catalog::CATALOG
        .iter()
        .flat_map(|d| d.ports.iter().copied())
        .collect();
    (FIRST_SITE_PORT..u16::MAX)
        .find(|p| !taken.contains(p) && !reserved.contains(p))
        .unwrap_or(FIRST_SITE_PORT)
}

fn doc_path(slug: &str, docroot: &str) -> String {
    if docroot == "." {
        format!("/sites/{slug}")
    } else {
        format!("/sites/{slug}/{docroot}")
    }
}

pub fn render_vhosts(sites: &[SiteSpec]) -> String {
    let mut out = String::new();
    for s in sites {
        let root = doc_path(&s.slug, &s.docroot);
        let _ = writeln!(out, "server {{");
        let _ = writeln!(out, "    listen {};", s.port);
        let _ = writeln!(out, "    server_name localhost;");
        let _ = writeln!(out, "    root {root};");
        let _ = writeln!(out, "    index index.php index.html;");
        match s.kind {
            SiteKind::Php => {
                let _ = writeln!(
                    out,
                    "    location / {{ try_files $uri $uri/ /index.php?$query_string; }}"
                );
                let _ = writeln!(out, "    location ~ \\.php$ {{");
                let _ = writeln!(out, "        fastcgi_pass php:9000;");
                let _ = writeln!(out, "        fastcgi_index index.php;");
                let _ = writeln!(out, "        include fastcgi_params;");
                let _ = writeln!(
                    out,
                    "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;"
                );
                let _ = writeln!(out, "    }}");
            }
            SiteKind::Static => {
                let _ = writeln!(out, "    location / {{ try_files $uri $uri/ =404; }}");
            }
        }
        let _ = writeln!(out, "}}\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site(slug: &str, docroot: &str, kind: SiteKind) -> SiteSpec {
        SiteSpec {
            slug: slug.into(),
            root: "/home/u/app".into(),
            docroot: docroot.into(),
            port: 8000,
            kind,
        }
    }

    #[test]
    fn php_root_is_the_mount_joined_with_the_docroot() {
        // The mount is the space root, not the docroot, or Laravel's
        // public/index.php could not reach ../vendor.
        let out = render_vhosts(&[site("app", "public", SiteKind::Php)]);
        assert!(out.contains("root /sites/app/public;"));
        assert!(out.contains("fastcgi_pass php:9000;"));
    }

    #[test]
    fn a_dot_docroot_does_not_produce_a_trailing_dot_path() {
        let out = render_vhosts(&[site("app", ".", SiteKind::Php)]);
        assert!(out.contains("root /sites/app;"));
        assert!(!out.contains("/sites/app/.;"));
    }

    #[test]
    fn static_sites_get_no_php_handler() {
        let out = render_vhosts(&[site("docs", ".", SiteKind::Static)]);
        assert!(!out.contains("fastcgi_pass"));
    }

    #[test]
    fn each_site_gets_exactly_one_server_block() {
        let out = render_vhosts(&[
            site("a", ".", SiteKind::Static),
            site("b", ".", SiteKind::Static),
        ]);
        assert_eq!(out.matches("server {").count(), 2);
    }

    #[test]
    fn assignment_skips_taken_and_catalog_ports() {
        let taken: BTreeSet<u16> = [8000, 8001, 8025].into_iter().collect();
        assert_eq!(assign_port(&taken), 8002);
    }
}
