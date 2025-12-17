#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building ios-helper..."
swift build -c release --product ios-helper

echo "Build complete: .build/release/ios-helper"
