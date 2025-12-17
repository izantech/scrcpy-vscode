#!/bin/bash
#
# WebDriverAgent Setup Script for scrcpy-vscode
# This script automatically sets up and starts WebDriverAgent for iOS touch/keyboard input.
#
# Requirements:
#   - macOS with Xcode installed
#   - iOS device connected via USB
#   - Apple ID (free account works, but apps expire after 7 days)
#
# Usage: ./scripts/setup-wda.sh
#

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
WDA_DIR="$HOME/.scrcpy-vscode/WebDriverAgent"
WDA_REPO="https://github.com/appium/WebDriverAgent.git"
NEEDS_FIRST_TIME_SETUP=false
IOS_HELPER_BIN=""

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▶${NC} ${BOLD}$1${NC}"
}

print_info() {
    echo -e "  ${CYAN}ℹ${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "  ${RED}✖${NC} $1"
}

print_success() {
    echo -e "  ${GREEN}✔${NC} $1"
}

wait_for_retry() {
    echo ""
    echo -e "  ${YELLOW}Press Enter to retry, or Ctrl+C to cancel...${NC}"
    read -r
    echo ""
}

check_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        print_error "This script only runs on macOS"
        exit 1
    fi
}

check_xcode() {
    while true; do
        print_step "Checking Xcode..."

        if ! command -v xcodebuild &> /dev/null; then
            print_error "Xcode is not installed"
            echo ""
            print_info "How to fix:"
            print_info "  1. Open the App Store"
            print_info "  2. Search for 'Xcode'"
            print_info "  3. Install Xcode (it's free)"
            print_info "  4. Open Xcode once to accept the license"
            wait_for_retry
            continue
        fi

        if ! xcode-select -p &> /dev/null; then
            print_warning "Xcode command line tools not configured"
            print_info "Running: xcode-select --install"
            xcode-select --install 2>/dev/null || true
            echo ""
            print_info "A dialog should appear. Click 'Install' and wait for completion."
            wait_for_retry
            continue
        fi

        local xcode_version
        xcode_version=$(xcodebuild -version 2>/dev/null | head -n1)
        print_success "$xcode_version"
        break
    done
}

check_homebrew() {
    while true; do
        if command -v brew &> /dev/null; then
            return 0
        fi

        print_error "Homebrew is not installed"
        echo ""
        print_info "How to fix:"
        print_info "  Run this command in Terminal:"
        echo ""
        echo -e "  ${BOLD}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
        echo ""
        print_info "  Or visit: https://brew.sh"
        wait_for_retry
    done
}

check_iproxy() {
    while true; do
        print_step "Checking iproxy..."

        if command -v iproxy &> /dev/null; then
            print_success "iproxy available"
            break
        fi

        print_warning "iproxy not installed"
        check_homebrew

        print_info "Installing libimobiledevice..."
        if brew install libimobiledevice 2>/dev/null; then
            print_success "iproxy installed"
            break
        else
            print_error "Failed to install libimobiledevice"
            echo ""
            print_info "How to fix:"
            print_info "  Try running manually: brew install libimobiledevice"
            wait_for_retry
        fi
    done
}

build_ios_helper() {
    print_step "Checking ios-helper..."

    local script_dir
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    local project_root
    project_root="$(dirname "$script_dir")"

    # Prefer the bundled binary (packaged extension / development build output)
    local bundled_helper="$project_root/dist/ios-helper/ios-helper"
    if [[ -f "$bundled_helper" ]]; then
        chmod +x "$bundled_helper" 2>/dev/null || true
        IOS_HELPER_BIN="$bundled_helper"
        print_success "ios-helper ready"
        return 0
    fi

    local helper_dir="$project_root/native/ios-helper"
    local build_dir="$helper_dir/.build"

    # Check if already built
    for arch in "arm64-apple-macosx" "x86_64-apple-macosx" ""; do
        local check_path="$build_dir/${arch:+$arch/}release/ios-helper"
        if [[ -f "$check_path" ]]; then
            IOS_HELPER_BIN="$check_path"
            print_success "ios-helper ready"
            return 0
        fi
    done

    if [[ ! -d "$helper_dir" ]]; then
        print_error "ios-helper source not found at $helper_dir"
        print_info "This is an internal error. Please reinstall the extension."
        exit 1
    fi

    while true; do
        if ! command -v swift &> /dev/null; then
            print_error "Swift is not installed"
            echo ""
            print_info "Swift comes with Xcode. Please ensure Xcode is fully installed."
            wait_for_retry
            continue
        fi

        print_info "Building ios-helper..."
        cd "$helper_dir" || exit 1

        if swift build -c release > /dev/null 2>&1; then
            # Locate built artifact
            local built_path=""
            for arch in "arm64-apple-macosx" "x86_64-apple-macosx" ""; do
                local candidate="$build_dir/${arch:+$arch/}release/ios-helper"
                if [[ -f "$candidate" ]]; then
                    built_path="$candidate"
                    break
                fi
            done

            if [[ -n "$built_path" ]]; then
                IOS_HELPER_BIN="$built_path"
                print_success "ios-helper built"
            else
                print_warning "ios-helper built, but binary not found in $build_dir"
            fi
            break
        else
            print_error "Failed to build ios-helper"
            echo ""
            print_info "How to fix:"
            print_info "  1. Make sure Xcode is fully installed"
            print_info "  2. Open Xcode and accept any license agreements"
            print_info "  3. Try running: sudo xcode-select --reset"
            wait_for_retry
        fi
    done
}

run_ios_helper_if_not_running() {
    if [[ -z "$IOS_HELPER_BIN" || ! -f "$IOS_HELPER_BIN" ]]; then
        return 0
    fi

    print_step "Checking ios-helper process..."

    # If VS Code is already mirroring an iOS device, ios-helper will be running.
    # Don't start another instance to avoid contention for the capture device.
    if pgrep -f "ios-helper.*stream" &> /dev/null; then
        print_success "ios-helper already running"
        return 0
    fi

    print_info "ios-helper not running. Running a quick self-test..."
    chmod +x "$IOS_HELPER_BIN" 2>/dev/null || true

    # `list` writes a binary protocol to stdout; discard output to keep the terminal readable.
    "$IOS_HELPER_BIN" list > /dev/null 2>/dev/null || true
    print_success "ios-helper OK"
}

check_ios_device() {
    while true; do
        print_step "Checking iOS device..."

        if ! command -v idevice_id &> /dev/null; then
            print_error "idevice_id not found"
            print_info "This should have been installed with iproxy. Retrying..."
            wait_for_retry
            continue
        fi

        local devices
        devices=$(idevice_id -l 2>/dev/null || true)

        if [[ -z "$devices" ]]; then
            print_error "No iOS device found"
            echo ""
            print_info "How to fix:"
            print_info "  1. Connect your iOS device via USB cable"
            print_info "  2. Unlock your device"
            print_info "  3. If prompted, tap 'Trust' on your device"
            print_info "  4. If still not working, try a different USB cable/port"
            wait_for_retry
            continue
        fi

        DEVICE_UDID=$(echo "$devices" | head -n1)
        DEVICE_NAME=$(ideviceinfo -u "$DEVICE_UDID" -k DeviceName 2>/dev/null || echo "iOS Device")
        local ios_version
        ios_version=$(ideviceinfo -u "$DEVICE_UDID" -k ProductVersion 2>/dev/null || echo "?")

        print_success "$DEVICE_NAME (iOS $ios_version)"
        break
    done
}

setup_wda_repo() {
    while true; do
        print_step "Checking WebDriverAgent..."

        if [[ -d "$WDA_DIR" ]]; then
            print_success "WDA repository ready"
            break
        fi

        print_info "Cloning WebDriverAgent..."
        mkdir -p "$(dirname "$WDA_DIR")"

        if git clone --depth 1 "$WDA_REPO" "$WDA_DIR" 2>/dev/null; then
            print_success "WDA cloned"
            NEEDS_FIRST_TIME_SETUP=true
            break
        else
            print_error "Failed to clone WebDriverAgent"
            echo ""
            print_info "How to fix:"
            print_info "  1. Check your internet connection"
            print_info "  2. Try: git clone $WDA_REPO"
            wait_for_retry
        fi
    done
}

check_wda_built() {
    print_step "Checking WDA build status..."

    cd "$WDA_DIR" || exit 1

    # Look for build products in DerivedData
    local derived_data="$HOME/Library/Developer/Xcode/DerivedData"
    local wda_build_found=false

    if [[ -d "$derived_data" ]]; then
        if find "$derived_data" -name "WebDriverAgentRunner-Runner.app" -type d 2>/dev/null | head -1 | grep -q .; then
            wda_build_found=true
        fi
    fi

    if $wda_build_found && ! $NEEDS_FIRST_TIME_SETUP; then
        print_success "WDA already built"
        return 0
    else
        print_info "WDA needs to be built"
        return 1
    fi
}

configure_signing() {
    print_step "Configuring code signing..."

    echo ""
    print_warning "First-time setup: You need to configure code signing in Xcode."
    print_info "This requires an Apple ID (free account works)."
    print_warning "Free accounts expire after 7 days - just re-run this script when it expires."
    echo ""

    print_info "Opening Xcode project..."
    open "$WDA_DIR/WebDriverAgent.xcodeproj"

    echo ""
    echo -e "${BOLD}In Xcode, configure these TWO targets:${NC}"
    echo ""
    echo "  ${BOLD}1. WebDriverAgentRunner${NC}"
    echo "     • Select target in left sidebar"
    echo "     • Click 'Signing & Capabilities' tab"
    echo "     • Check 'Automatically manage signing'"
    echo "     • Select your Team (add Apple ID if needed)"
    echo "     • If bundle ID error: change to com.YOURNAME.WebDriverAgentRunner"
    echo ""
    echo "  ${BOLD}2. IntegrationApp${NC}"
    echo "     • Same steps as above"
    echo ""

    read -r -p "Press Enter once BOTH targets are configured..."
}

build_wda() {
    while true; do
        print_step "Building WebDriverAgent..."

        cd "$WDA_DIR" || exit 1

        print_info "This may take a minute..."
        echo ""

        local build_log
        build_log=$(mktemp)

        if xcodebuild build-for-testing \
            -project WebDriverAgent.xcodeproj \
            -scheme WebDriverAgentRunner \
            -destination "id=$DEVICE_UDID" \
            -allowProvisioningUpdates 2>&1 | tee "$build_log"; then

            if grep -q "BUILD SUCCEEDED" "$build_log"; then
                print_success "WDA built successfully"
                rm -f "$build_log"
                break
            fi
        fi

        echo ""
        print_error "Build failed!"
        echo ""

        # Provide specific help based on error
        if grep -q "Signing for\|code signing\|provisioning profile" "$build_log"; then
            print_info "How to fix (Code Signing Error):"
            print_info "  1. Open Xcode (it should still be open)"
            print_info "  2. Select 'WebDriverAgentRunner' target"
            print_info "  3. Go to 'Signing & Capabilities'"
            print_info "  4. Enable 'Automatically manage signing'"
            print_info "  5. Select your Team (Apple ID)"
            print_info "  6. If bundle ID error: change to something unique"
            print_info "  7. Do the same for 'IntegrationApp' target"
        elif grep -q "device is locked" "$build_log"; then
            print_info "How to fix:"
            print_info "  Unlock your iOS device and try again"
        elif grep -q "Device is not available" "$build_log"; then
            print_info "How to fix:"
            print_info "  1. Disconnect and reconnect your iOS device"
            print_info "  2. Trust the computer on your device if prompted"
        else
            print_info "Check the build output above for details."
            print_info "Common fixes:"
            print_info "  - Ensure Xcode signing is configured for both targets"
            print_info "  - Unlock your iOS device"
            print_info "  - Trust the computer on your device"
        fi

        rm -f "$build_log"
        wait_for_retry

        # Re-check device in case it was disconnected
        check_ios_device
    done
}

start_wda() {
    while true; do
        print_step "Starting WebDriverAgent..."

        cd "$WDA_DIR" || exit 1

        # Kill any existing sessions
        pkill -f "iproxy.*8100" 2>/dev/null || true
        pkill -f "xcodebuild.*WebDriverAgent" 2>/dev/null || true
        sleep 1

        # Start iproxy first (so it's ready when WDA starts)
        iproxy 8100 8100 -u "$DEVICE_UDID" > /dev/null 2>&1 &
        IPROXY_PID=$!
        sleep 1

        # Start xcodebuild
        xcodebuild test-without-building \
            -project WebDriverAgent.xcodeproj \
            -scheme WebDriverAgentRunner \
            -destination "id=$DEVICE_UDID" \
            > /dev/null 2>&1 &

        XCODE_PID=$!

        # Cleanup handler
        cleanup() {
            echo ""
            print_info "Stopping WebDriverAgent..."
            kill "$XCODE_PID" "$IPROXY_PID" 2>/dev/null
            pkill -f "iproxy.*8100" 2>/dev/null
            pkill -f "xcodebuild.*WebDriverAgent" 2>/dev/null
            exit 0
        }
        trap cleanup INT TERM

        # Wait for WDA to start with retries (up to 30 seconds)
        print_info "Waiting for WDA to start on device..."
        local max_attempts=15
        local attempt=1
        local connected=false

        while [[ $attempt -le $max_attempts ]]; do
            sleep 2

            # Check if xcodebuild is still running
            if ! kill -0 $XCODE_PID 2>/dev/null; then
                print_error "WebDriverAgent process exited unexpectedly"
                break
            fi

            # Try to connect to WDA
            if curl -s --connect-timeout 2 http://localhost:8100/status 2>/dev/null | grep -q "sessionId\|ready\|value"; then
                connected=true
                break
            fi

            # Show progress
            printf "  Attempt %d/%d...\r" "$attempt" "$max_attempts"
            attempt=$((attempt + 1))
        done
        echo "" # Clear the progress line

        if $connected; then
            print_success "WebDriverAgent running at http://localhost:8100"
            echo ""
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${BOLD}  ✓ Ready! Touch input is now available in VS Code${NC}"
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            print_info "Keep this terminal open. Press Ctrl+C to stop."
            echo ""
            wait $XCODE_PID 2>/dev/null
            break
        else
            print_error "Failed to connect to WebDriverAgent"
            kill "$XCODE_PID" "$IPROXY_PID" 2>/dev/null
            echo ""
            print_info "How to fix:"
            print_info "  1. Check your iOS device - you may need to trust the developer"
            print_info "     Go to: Settings > General > VPN & Device Management"
            print_info "  2. Make sure the WDA app launched on your device"
            print_info "  3. Try disconnecting and reconnecting your device"
            wait_for_retry
            check_ios_device
        fi
    done
}

# Main
main() {
    print_header "WebDriverAgent for scrcpy-vscode"

    check_macos
    check_xcode
    check_iproxy
    build_ios_helper
    check_ios_device
    run_ios_helper_if_not_running
    setup_wda_repo

    if ! check_wda_built; then
        configure_signing
        build_wda
    fi

    start_wda
}

main "$@"
