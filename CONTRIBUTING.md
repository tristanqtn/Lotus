# Contributing to Lotus

Thank you for your interest in contributing to Lotus! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported by searching the [GitHub Issues](https://github.com/trist/Lotus/issues).
2. If the bug hasn't been reported, create a new issue using the Bug Report template.
3. Be sure to include a clear title, description, and as much relevant information as possible.

### Suggesting Features

1. Check if the feature has already been suggested by searching the [GitHub Issues](https://github.com/tristanqtn/Lotus/issues).
2. If the feature hasn't been suggested, create a new issue using the Feature Request template.
3. Be clear about what the feature should do and why it would be valuable.

### Pull Requests

1. Fork the repository.
2. Create a new branch from `main` for your changes.
3. Make your changes and ensure they follow the project's coding style.
4. Run tests and linting to ensure your changes don't break existing functionality.
5. Update documentation as needed.
6. Submit a pull request.

## Development Setup

1. Clone the repository: `git clone https://github.com/tristanqtn/Lotus`
2. Install dependencies: `npm install`
3. Make your changes
4. Lint your code: `npm run lint`
5. Build the extension: `npm run build`

## Testing Your Changes

1. Load the unpacked extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the Lotus directory
2. Test your changes in different scenarios
3. Verify that existing functionality still works

## Release Process

The release process is automated using GitHub Actions:

1. When code is pushed to the main branch, a new release is created automatically
2. The version number is taken from the `manifest.json` file
3. The extension is packaged into a ZIP file and attached to the GitHub release
4. Release notes are generated automatically from commit messages

To create a new release:
1. Update the version in `manifest.json`
2. Push your changes to the main branch
3. GitHub Actions will automatically build and publish the release

## Style Guide

- Use meaningful variable and function names
- Keep functions small and focused
- Comment complex logic
- Follow the existing code style
- Use ES6+ features where appropriate

Thank you for contributing to Lotus!
