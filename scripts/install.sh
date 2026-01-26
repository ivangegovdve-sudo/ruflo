#!/usr/bin/env bash
#
# Claude Flow Installer
# https://github.com/ruvnet/claude-flow
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ruvnet/claude-flow/main/scripts/install.sh | bash
#   curl -fsSL https://claude-flow.ruv.io/install.sh | bash
#
# Options:
#   CLAUDE_FLOW_VERSION=3.0.0-alpha.181  # Specific version
#   CLAUDE_FLOW_MINIMAL=1                 # Minimal install (no optional deps)
#   CLAUDE_FLOW_GLOBAL=1                  # Global install (default: npx)
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Configuration
VERSION="${CLAUDE_FLOW_VERSION:-alpha}"
MINIMAL="${CLAUDE_FLOW_MINIMAL:-0}"
GLOBAL="${CLAUDE_FLOW_GLOBAL:-0}"
PACKAGE="claude-flow@${VERSION}"

# Progress animation
SPINNER_CHARS="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPINNER_INDEX=0

spinner() {
    printf "\r${CYAN}${SPINNER_CHARS:SPINNER_INDEX++:1}${NC} $1"
    SPINNER_INDEX=$((SPINNER_INDEX % 10))
}

print_banner() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}🌊 Claude Flow${NC} - Enterprise AI Agent Orchestration     ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▸${NC} $1"
}

print_substep() {
    echo -e "  ${DIM}├─${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

check_requirements() {
    print_step "Checking requirements..."

    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [ "$NODE_MAJOR" -ge 20 ]; then
            print_substep "Node.js ${GREEN}v${NODE_VERSION}${NC} ✓"
        else
            print_error "Node.js 20+ required (found v${NODE_VERSION})"
            echo ""
            echo "Install Node.js 20+:"
            echo "  curl -fsSL https://fnm.vercel.app/install | bash"
            echo "  fnm install 20"
            exit 1
        fi
    else
        print_error "Node.js not found"
        echo ""
        echo "Install Node.js 20+:"
        echo "  curl -fsSL https://fnm.vercel.app/install | bash"
        echo "  fnm install 20"
        exit 1
    fi

    # Check npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        print_substep "npm ${GREEN}v${NPM_VERSION}${NC} ✓"
    else
        print_error "npm not found"
        exit 1
    fi

    echo ""
}

show_install_options() {
    print_step "Installation options:"
    print_substep "Package: ${BOLD}${PACKAGE}${NC}"
    if [ "$GLOBAL" = "1" ]; then
        print_substep "Mode: ${BOLD}Global${NC} (npm install -g)"
    else
        print_substep "Mode: ${BOLD}npx${NC} (on-demand)"
    fi
    if [ "$MINIMAL" = "1" ]; then
        print_substep "Profile: ${BOLD}Minimal${NC} (--omit=optional)"
    else
        print_substep "Profile: ${BOLD}Full${NC} (all features)"
    fi
    echo ""
}

install_package() {
    local START_TIME=$(date +%s)

    if [ "$GLOBAL" = "1" ]; then
        print_step "Installing globally..."

        if [ "$MINIMAL" = "1" ]; then
            npm install -g "$PACKAGE" --omit=optional 2>&1 | while read -r line; do
                if [[ "$line" == *"added"* ]]; then
                    print_substep "$line"
                fi
            done
        else
            npm install -g "$PACKAGE" 2>&1 | while read -r line; do
                if [[ "$line" == *"added"* ]]; then
                    print_substep "$line"
                fi
            done
        fi
    else
        print_step "Setting up for npx usage..."
        # Pre-cache the package for faster npx
        npm cache add "$PACKAGE" 2>/dev/null || true
        print_substep "Package cached for npx"
    fi

    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))

    echo ""
    print_success "Installed in ${BOLD}${DURATION}s${NC}"
}

verify_installation() {
    print_step "Verifying installation..."

    local VERSION_OUTPUT
    if [ "$GLOBAL" = "1" ]; then
        VERSION_OUTPUT=$(claude-flow --version 2>/dev/null || echo "")
    else
        VERSION_OUTPUT=$(npx -y "$PACKAGE" --version 2>/dev/null || echo "")
    fi

    if [ -n "$VERSION_OUTPUT" ]; then
        print_substep "Version: ${GREEN}${VERSION_OUTPUT}${NC}"
        echo ""
        return 0
    else
        print_error "Installation verification failed"
        return 1
    fi
}

show_quickstart() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}🚀 Quick Start${NC}                                          ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [ "$GLOBAL" = "1" ]; then
        echo -e "  ${DIM}# Initialize project${NC}"
        echo -e "  ${BOLD}claude-flow init --wizard${NC}"
        echo ""
        echo -e "  ${DIM}# Run system diagnostics${NC}"
        echo -e "  ${BOLD}claude-flow doctor${NC}"
        echo ""
        echo -e "  ${DIM}# Add as MCP server to Claude Code${NC}"
        echo -e "  ${BOLD}claude mcp add claude-flow -- claude-flow mcp start${NC}"
    else
        echo -e "  ${DIM}# Initialize project${NC}"
        echo -e "  ${BOLD}npx claude-flow@alpha init --wizard${NC}"
        echo ""
        echo -e "  ${DIM}# Run system diagnostics${NC}"
        echo -e "  ${BOLD}npx claude-flow@alpha doctor${NC}"
        echo ""
        echo -e "  ${DIM}# Add as MCP server to Claude Code${NC}"
        echo -e "  ${BOLD}claude mcp add claude-flow -- npx -y claude-flow@alpha mcp start${NC}"
    fi

    echo ""
    echo -e "${DIM}Documentation: https://github.com/ruvnet/claude-flow${NC}"
    echo -e "${DIM}Issues: https://github.com/ruvnet/claude-flow/issues${NC}"
    echo ""
}

# Main
main() {
    print_banner
    check_requirements
    show_install_options
    install_package
    verify_installation
    show_quickstart

    print_success "${BOLD}Claude Flow is ready!${NC} 🎉"
    echo ""
}

main "$@"
