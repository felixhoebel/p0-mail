fn main() {
    tauri_build::build();

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let env_path = std::path::Path::new(&manifest_dir).join("..").join(".env");
    if let Ok(iter) = dotenvy::from_path_iter(&env_path) {
        for item in iter {
            if let Ok((key, val)) = item {
                if key.starts_with("GOOGLE_") || key.starts_with("MICROSOFT_") {
                    println!("cargo:rustc-env={}={}", key, val);
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=../.env");
}
