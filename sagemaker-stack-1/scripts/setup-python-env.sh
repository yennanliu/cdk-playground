#!/bin/bash
set -e

echo "=================================="
echo "Python Environment Setup with uv"
echo "=================================="

# Navigate to project root
PROJECT_ROOT="$(dirname "$0")/.."
cd "$PROJECT_ROOT"

# Check if uv is installed
echo "Checking for uv installation..."
if command -v uv &> /dev/null; then
    UV_VERSION=$(uv --version)
    echo "✓ uv is installed: $UV_VERSION"
else
    echo "✗ uv is not installed"
    echo ""
    echo "Installing uv..."

    # Detect OS and install accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            echo "Using Homebrew to install uv..."
            brew install uv
        else
            echo "Using install script..."
            curl -LsSf https://astral.sh/uv/install.sh | sh
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "Using install script..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
    else
        # Windows or other
        echo "Please install uv manually:"
        echo "  https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi

    # Reload shell to pick up uv
    export PATH="$HOME/.local/bin:$PATH"

    if command -v uv &> /dev/null; then
        echo "✓ uv installed successfully!"
        uv --version
    else
        echo "✗ uv installation failed. Please install manually:"
        echo "  https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi
fi

echo ""
echo "=================================="
echo "Setting up Python environment..."
echo "=================================="

# Check if .python-version exists
if [ -f ".python-version" ]; then
    PYTHON_VERSION=$(cat .python-version)
    echo "Python version specified: $PYTHON_VERSION"
else
    echo "✗ .python-version file not found!"
    exit 1
fi

# Install Python if needed
echo ""
echo "Installing Python $PYTHON_VERSION with uv..."
uv python install $PYTHON_VERSION

# Create virtual environment
echo ""
echo "Creating virtual environment..."
if [ -d ".venv" ]; then
    echo "Virtual environment already exists at .venv"
    echo "Removing existing environment..."
    rm -rf .venv
fi

uv venv .venv --python $PYTHON_VERSION

# Activate virtual environment
echo ""
echo "Activating virtual environment..."
source .venv/bin/activate

# Verify Python version in venv
echo ""
echo "Verifying Python in virtual environment..."
python --version
echo "Python location: $(which python)"

echo ""
echo "=================================="
echo "Installing project dependencies..."
echo "=================================="

# Install dependencies using uv
echo "Installing dependencies from model/requirements.txt..."
uv pip install -r model/requirements.txt

# Verify installation
echo ""
echo "Verifying installed packages..."
uv pip list

echo ""
echo "=================================="
echo "✓ Setup complete!"
echo "=================================="
echo ""
echo "Virtual environment created at: .venv"
echo ""
echo "To activate manually:"
echo "  source .venv/bin/activate"
echo ""
echo "To deactivate:"
echo "  deactivate"
echo ""
echo "Next steps:"
echo "  1. Train model: ./scripts/train-and-package-model.sh"
echo "  2. Deploy: cdk deploy"
