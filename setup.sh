#!/bin/bash
# One-command setup for ClawPlatform  
# Usage: ./setup.sh

set -e
echo "🦞 Setting up ClawPlatform..."

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load services environment if available
SERVICES_ENV="../.env.services"
if [[ -f "$SERVICES_ENV" ]]; then
    print_status "Loading services configuration..."
    # shellcheck source=/dev/null
    source "$SERVICES_ENV"
    print_success "Services configuration loaded"
else
    print_warning "Services configuration not found at $SERVICES_ENV"
    print_warning "Run ../setup-services.sh first for external services setup"
fi

# Check prerequisites
print_status "Checking prerequisites..."

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js is required but not installed."
    echo "Please install Node.js first: https://nodejs.org"
    exit 1
fi
print_success "Node.js is installed ($(node --version))"

# Setup backend dependencies
print_status "Setting up backend dependencies..."
if [ -d "backend/functions" ]; then
    cd backend/functions
    if npm install; then
        print_success "Backend dependencies installed"
    else
        print_error "Failed to install backend dependencies"
        cd ../..
        exit 1
    fi
    cd ../..
else
    print_warning "Backend functions directory not found, skipping backend setup"
fi

# Check/install Firebase CLI
if ! command -v firebase >/dev/null 2>&1; then
    print_status "Installing Firebase CLI..."
    if npm install -g firebase-tools; then
        print_success "Firebase CLI installed"
    else
        print_warning "Failed to install Firebase CLI"
    fi
else
    print_success "Firebase CLI is already installed"
fi

# Setup external services
if [[ -f "$SERVICES_ENV" ]]; then
    print_status "External services configured ✅"
elif [[ -f "../setup-services.sh" ]]; then
    print_warning "External services not configured"
    echo ""
    echo "🔧 To set up Firebase, Stripe, and other services:"
    echo "   cd .. && ./setup-services.sh"
    echo ""
fi

# Create .env file
if [ ! -f ".env" ]; then
    print_status "Creating .env file..."
    
    if [[ -n "${FIREBASE_PROJECT_ID:-}" ]]; then
        cat > .env << ENVEOF
# Generated from services setup
FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID
FIREBASE_DATABASE_URL=$FIREBASE_DATABASE_URL
FIREBASE_STORAGE_BUCKET=$FIREBASE_STORAGE_BUCKET
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
OPENAI_API_KEY=$OPENAI_API_KEY
STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY
DEBUG_MODE=true
ENVEOF
        print_success ".env file created with services configuration"
    else
        cat > .env << ENVEOF
# Configure these after running ../setup-services.sh
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
STRIPE_PUBLISHABLE_KEY=your_stripe_key
DEBUG_MODE=true
ENVEOF
        print_success ".env file created"
        print_warning "Run ../setup-services.sh to configure external services"
    fi
else
    print_success ".env file already exists"
fi

echo ""
print_success "✅ Setup complete!"
echo ""
echo "🚀 Next steps:"
echo "1. Configure external services: cd .. && ./setup-services.sh"
echo "2. Start the backend: cd backend && firebase emulators:start"
echo ""
print_status "Happy coding! 🦞"
