# Using UV for Python Environment Management

This project uses `uv` for Python dependency management instead of `pip`. This provides:
- **Faster installs** (10-100x faster than pip)
- **Isolated environment** (project-specific .venv)
- **Reproducible builds** (consistent dependency resolution)
- **Automatic Python installation** (no need to install Python manually)

## Why UV?

Traditional approach with pip:
```bash
# Manual steps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

With uv:
```bash
# One command does it all
./scripts/setup-python-env.sh
```

## Project Structure

```
sagemaker-stack-1/
├── .python-version          # Specifies Python 3.10
├── .venv/                   # Virtual environment (created by uv)
├── model/
│   └── requirements.txt     # Python dependencies
└── scripts/
    ├── setup-python-env.sh  # Creates venv and installs deps
    └── train-and-package-model.sh  # Uses venv to train model
```

## How It Works

### 1. Initial Setup

`./scripts/setup-python-env.sh` does:

1. **Checks for uv** - Installs if missing
2. **Reads .python-version** - Knows to use Python 3.10
3. **Installs Python 3.10** - Via `uv python install 3.10`
4. **Creates virtual environment** - At `.venv/`
5. **Installs dependencies** - From `model/requirements.txt`

### 2. Training Model

`./scripts/train-and-package-model.sh` does:

1. **Checks for .venv** - Fails if not set up
2. **Activates venv** - `source .venv/bin/activate`
3. **Trains model** - Using packages from .venv
4. **Packages model** - Creates model.tar.gz

## Commands

### Setup (First Time)
```bash
./scripts/setup-python-env.sh
```

### Manual Activation
```bash
# Activate venv
source .venv/bin/activate

# Now you can use Python directly
python model/train.py

# Deactivate when done
deactivate
```

### Adding New Dependencies
```bash
# 1. Add to model/requirements.txt
echo "new-package==1.0.0" >> model/requirements.txt

# 2. Reinstall
source .venv/bin/activate
uv pip install -r model/requirements.txt
```

### Cleaning Up
```bash
# Remove virtual environment
rm -rf .venv

# Recreate from scratch
./scripts/setup-python-env.sh
```

## Benefits Over System Python

### ❌ Using System Python (DON'T DO THIS)
```bash
pip install -r requirements.txt  # Installs globally
python train.py                  # Uses system Python
```

**Problems:**
- Pollutes system Python
- Version conflicts with other projects
- Hard to reproduce on another machine
- Can break system tools

### ✅ Using UV + Virtual Environment (DO THIS)
```bash
./scripts/setup-python-env.sh    # Isolated environment
./scripts/train-and-package-model.sh  # Uses project Python
```

**Benefits:**
- Clean isolation per project
- Reproducible across machines
- No conflicts with other projects
- Easy to delete and recreate

## Verification

Check that you're using the virtual environment:

```bash
# Activate venv
source .venv/bin/activate

# Check Python location
which python
# Should output: /path/to/sagemaker-stack-1/.venv/bin/python

# Check Python version
python --version
# Should output: Python 3.10.x

# Check installed packages
uv pip list
```

## Troubleshooting

### uv not found
```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or on macOS
brew install uv

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

### Virtual environment not found
```bash
# Create it
./scripts/setup-python-env.sh
```

### Wrong Python version
```bash
# Check .python-version file
cat .python-version
# Should contain: 3.10

# Recreate venv
rm -rf .venv
./scripts/setup-python-env.sh
```

### Import errors
```bash
# Reinstall dependencies
source .venv/bin/activate
uv pip install -r model/requirements.txt
```

## Comparison: pip vs uv

| Feature | pip | uv |
|---------|-----|-----|
| Install speed | Slow | 10-100x faster |
| Python installation | Manual | Automatic |
| Venv creation | Manual | Automatic |
| Dependency resolution | Can conflict | Guaranteed consistent |
| Cache | Limited | Global cache |
| Lock files | Separate tool | Built-in |

## Under the Hood

When you run `./scripts/setup-python-env.sh`:

```bash
# 1. uv installs Python to ~/.local/share/uv/python/
uv python install 3.10

# 2. uv creates venv with that Python
uv venv .venv --python 3.10

# 3. uv installs packages to .venv/lib/python3.10/site-packages/
uv pip install -r model/requirements.txt
```

The `.venv` directory contains:
```
.venv/
├── bin/
│   ├── python       # Python 3.10 interpreter
│   ├── pip          # Wrapped pip
│   └── activate     # Activation script
├── lib/
│   └── python3.10/
│       └── site-packages/  # Installed packages
└── pyvenv.cfg       # Config pointing to Python 3.10
```

## CI/CD Integration

For GitHub Actions or other CI:

```yaml
- name: Setup Python with uv
  run: |
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    ./scripts/setup-python-env.sh

- name: Train model
  run: |
    ./scripts/train-and-package-model.sh
```

## References

- uv Documentation: https://docs.astral.sh/uv/
- uv GitHub: https://github.com/astral-sh/uv
- Python virtual environments: https://docs.python.org/3/library/venv.html
