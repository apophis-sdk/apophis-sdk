#!/bin/bash
dir=$(realpath $(dirname $0))

static_order="core cosmos cosmwasm cosmos-signers"
# Create space-separated string of full package paths
static_order_packages=""
for pkg in $static_order; do
  static_order_packages+="$dir/packages/$pkg "
done
static_order_packages=${static_order_packages% } # Remove trailing space

if [ "$1" = "clean" ]; then
  echo "Cleaning all packages"
  cd "$dir"
  rm -rf packages/*/dist packages/*/*.tsbuildinfo
  exit 0
fi

# Build static order packages first
for package in $static_order_packages; do
  cd "$package"
  name=$(jq -r .name package.json)
  echo "Building package $name"
  bun run build
done

# Build remaining packages
for package in $(printf '%s ' $dir/packages/*); do
  # Skip if package is in static order
  if [[ $static_order_packages =~ $package ]]; then
    continue
  fi

  cd "$package"
  name=$(jq -r .name package.json)
  echo "Building package $name"
  bun run build
done
