#!/bin/bash
#
# WebDriverAgent Setup Script for scrcpy-vscode
# This script helps you install WebDriverAgent on your iOS device for touch/keyboard input control.
#
# Requirements:
#   - macOS with Xcode installed
#   - iOS device connected via USB
#   - Apple ID (free account works, but apps expire after 7 days)
#
# Usage: ./scripts/setup-wda.sh
#

set -e

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

check_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        print_error "This script only runs on macOS"
        exit 1
    fi
}

check_xcode() {
    print_step "Checking Xcode installation..."

    if ! command -v xcodebuild &> /dev/null; then
        print_error "Xcode is not installed"
        print_info "Please install Xcode from the App Store"
        exit 1
    fi

    # Check if Xcode command line tools are installed
    if ! xcode-select -p &> /dev/null; then
        print_warning "Xcode command line tools not configured"
        print_info "Running: xcode-select --install"
        xcode-select --install
        exit 1
    fi

    local xcode_version
    xcode_version=$(xcodebuild -version | head -n1)
    print_success "Found: $xcode_version"
}

check_iproxy() {
    print_step "Checking iproxy (libimobiledevice)..."

    if ! command -v iproxy &> /dev/null; then
        print_warning "iproxy is not installed"
        print_info "Installing via Homebrew..."

        if ! command -v brew &> /dev/null; then
            print_error "Homebrew is not installed"
            print_info "Install from: https://brew.sh"
            exit 1
        fi

        brew install libimobiledevice
        print_success "iproxy installed"
    else
        print_success "iproxy is installed"
    fi
}

check_ios_device() {
    print_step "Checking for connected iOS devices..."

    if ! command -v idevice_id &> /dev/null; then
        print_error "idevice_id not found (part of libimobiledevice)"
        exit 1
    fi

    local devices
    devices=$(idevice_id -l 2>/dev/null || true)

    if [[ -z "$devices" ]]; then
        print_error "No iOS device found"
        print_info "Please connect your iOS device via USB"
        print_info "Make sure to trust the computer on your device"
        exit 1
    fi

    echo ""
    print_info "Found device(s):"
    while IFS= read -r udid; do
        local name
        name=$(ideviceinfo -u "$udid" -k DeviceName 2>/dev/null || echo "Unknown")
        local ios_version
        ios_version=$(ideviceinfo -u "$udid" -k ProductVersion 2>/dev/null || echo "Unknown")
        echo -e "    ${BOLD}$name${NC} (iOS $ios_version)"
        echo -e "    UDID: $udid"
    done <<< "$devices"

    # Use first device
    DEVICE_UDID=$(echo "$devices" | head -n1)
    DEVICE_NAME=$(ideviceinfo -u "$DEVICE_UDID" -k DeviceName 2>/dev/null || echo "iOS Device")

    print_success "Will use: $DEVICE_NAME"
}

check_developer_mode() {
    print_step "Checking Developer Mode..."

    local ios_version
    ios_version=$(ideviceinfo -u "$DEVICE_UDID" -k ProductVersion 2>/dev/null || echo "0")
    local major_version
    major_version=$(echo "$ios_version" | cut -d. -f1)

    if [[ "$major_version" -ge 16 ]]; then
        print_warning "iOS 16+ requires Developer Mode to be enabled"
        print_info "Go to: Settings > Privacy & Security > Developer Mode"
        print_info "Enable Developer Mode and restart your device"
        echo ""
        read -p "Press Enter once Developer Mode is enabled, or Ctrl+C to cancel..."
    else
        print_success "iOS $ios_version (Developer Mode not required)"
    fi
}

clone_wda() {
    print_step "Setting up WebDriverAgent..."

    if [[ -d "$WDA_DIR" ]]; then
        print_info "WebDriverAgent already exists at $WDA_DIR"
        read -p "Update to latest version? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "Updating WebDriverAgent..."
            cd "$WDA_DIR"
            git pull
            print_success "Updated to latest version"
        fi
    else
        print_info "Cloning WebDriverAgent repository..."
        mkdir -p "$(dirname "$WDA_DIR")"
        git clone "$WDA_REPO" "$WDA_DIR"
        print_success "WebDriverAgent cloned to $WDA_DIR"
    fi
}

configure_signing() {
    print_step "Configuring code signing..."

    echo ""
    print_info "You need to configure code signing in Xcode."
    print_info "This requires an Apple ID (free account works)."
    echo ""
    print_warning "Free accounts have a 7-day expiration. You'll need to reinstall WDA after it expires."
    echo ""

    print_info "Opening Xcode project..."
    open "$WDA_DIR/WebDriverAgent.xcodeproj"

    echo ""
    echo -e "${BOLD}Please follow these steps in Xcode:${NC}"
    echo ""
    echo "  1. Select 'WebDriverAgentRunner' target in the left sidebar"
    echo "  2. Go to 'Signing & Capabilities' tab"
    echo "  3. Check 'Automatically manage signing'"
    echo "  4. Select your Team (add your Apple ID if needed)"
    echo "  5. If you see a bundle ID error, change it to something unique"
    echo "     Example: com.yourname.WebDriverAgentRunner"
    echo ""
    echo "  6. Also configure signing for 'IntegrationApp' target"
    echo "     (same steps as above)"
    echo ""

    read -p "Press Enter once signing is configured, or Ctrl+C to cancel..."
}

build_wda() {
    print_step "Building WebDriverAgent for $DEVICE_NAME..."

    cd "$WDA_DIR"

    print_info "This may take a few minutes..."
    print_info "If prompted, unlock your device and trust the developer certificate"
    echo ""

    # Build for testing - capture output and exit code
    local build_log
    build_log=$(mktemp)

    if xcodebuild build-for-testing \
        -project WebDriverAgent.xcodeproj \
        -scheme WebDriverAgentRunner \
        -destination "id=$DEVICE_UDID" \
        -allowProvisioningUpdates 2>&1 | tee "$build_log"; then

        # Check if build actually succeeded (xcodebuild can return 0 even with errors)
        if grep -q "BUILD SUCCEEDED" "$build_log"; then
            print_success "WebDriverAgent built successfully!"
            rm -f "$build_log"
        else
            print_error "Build completed but may have issues. Check output above."
            rm -f "$build_log"
            exit 1
        fi
    else
        echo ""
        print_error "Build failed!"
        echo ""

        # Check for common errors and provide guidance
        if grep -q "code signing identity" "$build_log" || grep -q "Signing for" "$build_log"; then
            print_warning "Code signing error detected."
            echo ""
            echo -e "${BOLD}Please ensure in Xcode:${NC}"
            echo "  1. Select 'WebDriverAgentRunner' target"
            echo "  2. Go to 'Signing & Capabilities' tab"
            echo "  3. Check 'Automatically manage signing'"
            echo "  4. Select a valid Team (your Apple ID)"
            echo "  5. If bundle ID conflicts, change it to something unique"
            echo "     e.g., com.yourname.WebDriverAgentRunner"
            echo ""
            echo "  Also do the same for 'IntegrationApp' target!"
        fi

        if grep -q "device is locked" "$build_log"; then
            print_warning "Device is locked. Please unlock your iPhone and try again."
        fi

        rm -f "$build_log"
        exit 1
    fi
}

test_wda() {
    print_step "Installing and launching WebDriverAgent on device..."

    cd "$WDA_DIR"

    print_info "Starting WebDriverAgent test runner..."
    print_warning "Keep this terminal open while using WDA"
    echo ""

    # Start xcodebuild test in background
    xcodebuild test-without-building \
        -project WebDriverAgent.xcodeproj \
        -scheme WebDriverAgentRunner \
        -destination "id=$DEVICE_UDID" \
        -allowProvisioningUpdates &

    XCODE_PID=$!

    # Wait for WDA to start
    sleep 5

    # Start iproxy
    print_info "Starting USB tunnel (iproxy)..."
    iproxy 8100 8100 -u "$DEVICE_UDID" &
    IPROXY_PID=$!

    sleep 2

    # Test connection
    print_step "Testing WDA connection..."
    if curl -s http://localhost:8100/status | grep -q "ready"; then
        print_success "WebDriverAgent is running and accessible!"
        echo ""
        print_info "WDA is ready. You can now enable it in VS Code:"
        print_info "Settings > scrcpy > iOS: Web Driver Agent Enabled"
        echo ""
        print_warning "Keep this terminal open to maintain the connection"
        print_info "Press Ctrl+C to stop WDA"

        # Wait for user to stop
        trap "kill $XCODE_PID $IPROXY_PID 2>/dev/null; exit 0" INT TERM
        wait $XCODE_PID
    else
        print_error "Could not connect to WebDriverAgent"
        print_info "Check your device - you may need to trust the developer"
        print_info "Go to: Settings > General > Device Management"
        kill $XCODE_PID $IPROXY_PID 2>/dev/null
        exit 1
    fi
}

run_wda_only() {
    print_step "Starting WebDriverAgent..."

    # Check if WDA directory exists
    if [[ ! -d "$WDA_DIR" ]]; then
        print_error "WebDriverAgent not found at $WDA_DIR"
        print_info "Run '$0 setup' first to install WebDriverAgent."
        exit 1
    fi

    cd "$WDA_DIR"

    print_info "Launching WebDriverAgent on $DEVICE_NAME..."

    xcodebuild test-without-building \
        -project WebDriverAgent.xcodeproj \
        -scheme WebDriverAgentRunner \
        -destination "id=$DEVICE_UDID" &

    XCODE_PID=$!
    sleep 3

    iproxy 8100 8100 -u "$DEVICE_UDID" &
    IPROXY_PID=$!
    sleep 2

    if curl -s http://localhost:8100/status | grep -q "ready"; then
        print_success "WebDriverAgent is running!"
        print_info "Press Ctrl+C to stop"
        trap "kill $XCODE_PID $IPROXY_PID 2>/dev/null; exit 0" INT TERM
        wait $XCODE_PID
    else
        print_error "Failed to start WebDriverAgent"
        kill $XCODE_PID $IPROXY_PID 2>/dev/null
        exit 1
    fi
}

print_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  setup    Full setup (clone, configure, build, run)"
    echo "  start    Start WDA (requires previous setup)"
    echo "  help     Show this help message"
    echo ""
}

# Main
main() {
    print_header "WebDriverAgent Setup for scrcpy-vscode"

    local command="${1:-setup}"

    case "$command" in
        setup)
            check_macos
            check_xcode
            check_iproxy
            check_ios_device
            check_developer_mode
            clone_wda
            configure_signing
            build_wda
            test_wda
            ;;
        start|run)
            check_macos
            check_iproxy
            check_ios_device
            run_wda_only
            ;;
        help|--help|-h)
            print_usage
            ;;
        *)
            print_error "Unknown command: $command"
            print_usage
            exit 1
            ;;
    esac
}

main "$@"
