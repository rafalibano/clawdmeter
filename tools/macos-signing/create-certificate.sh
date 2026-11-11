#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly COMMON_NAME="ClawdMeter Self-Signed"
readonly VALID_DAYS=3650
readonly OPENSSL=/usr/bin/openssl

out_dir="${1:-$HOME/.tauri/clawdmeter-macos-signing}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: run this on macOS (it relies on /usr/bin/openssl, whose .p12 the macOS security tool imports)." >&2
  exit 1
fi

created_dir=false
if [ ! -d "$out_dir" ]; then
  mkdir -p "$out_dir"
  created_dir=true
fi
out_dir="$(cd "$out_dir" && pwd -P)"

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
case "$out_dir/" in
  "$repo_root"/*)
    if [ "$created_dir" = true ]; then rmdir "$out_dir"; fi
    echo "error: $out_dir is inside the repository; pick a directory outside it (default: ~/.tauri/clawdmeter-macos-signing)." >&2
    exit 1
    ;;
esac
chmod 700 "$out_dir"

p12="$out_dir/certificate.p12"
p12_base64="$out_dir/certificate.p12.base64"
password_file="$out_dir/certificate-password.txt"
cert_pem="$out_dir/certificate.pem"

for file in "$p12" "$p12_base64" "$password_file" "$cert_pem"; do
  if [ -e "$file" ]; then
    echo "error: $file already exists. A new certificate changes the app's signature and macOS asks for the Keychain password again after the next update; move the old files away first if that is really what you want." >&2
    exit 1
  fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat >"$work/openssl.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext

[dn]
CN = $COMMON_NAME

[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

"$OPENSSL" req -x509 -newkey rsa:3072 -sha256 -nodes -days "$VALID_DAYS" \
  -config "$work/openssl.cnf" -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null

"$OPENSSL" rand -base64 32 | tr -d '\n' >"$password_file"

"$OPENSSL" pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$COMMON_NAME" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "file:$password_file" -out "$p12"

base64 -i "$p12" | tr -d '\n' >"$p12_base64"
cp "$work/cert.pem" "$cert_pem"
chmod 600 "$p12" "$p12_base64" "$password_file" "$cert_pem"

fingerprint="$("$OPENSSL" x509 -in "$cert_pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
expires="$("$OPENSSL" x509 -in "$cert_pem" -noout -enddate | cut -d= -f2)"

cat <<EOF
Created the code signing certificate "$COMMON_NAME".
  SHA-1:   $fingerprint
  Expires: $expires
  Files:   $out_dir (certificate.p12, certificate.p12.base64, certificate-password.txt, certificate.pem)

Keep a backup of certificate.p12 and certificate-password.txt somewhere safe (a password manager).
Losing them means a new certificate, and macOS asks for the Keychain password once more after that update.

From the clawdmeter checkout, save them as secrets of the "release" environment:

  gh secret set APPLE_CERTIFICATE --env release < "$p12_base64"
  gh secret set APPLE_CERTIFICATE_PASSWORD --env release < "$password_file"
  gh secret set APPLE_SIGNING_IDENTITY --env release --body "$COMMON_NAME"

Nothing was sent anywhere and nothing was added to your Keychain.
EOF
