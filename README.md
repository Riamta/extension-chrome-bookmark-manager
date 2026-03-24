# Bookmark Manager

A beautiful bookmark manager Chrome extension inspired by Raindrop.io. Save, organize, and search your bookmarks with collections and tags.

## Features

- 📚 Save bookmarks with automatic title and favicon detection
- 📁 Organize bookmarks into collections
- 🏷️ Tag bookmarks for easy categorization
- 🔍 Powerful search functionality
- 📝 Add notes to bookmarks
- ⭐ Rate bookmarks with stars
- 🎨 Clean, modern UI with dark mode support
- ⚡ Fast virtualized list for performance with many bookmarks
- 🤖 AI-powered tag suggestions

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Chrome Extensions Manifest V3** - Extension API
- **Lucide React** - Icons
- **React Virtuoso** - Virtualized list rendering

## Development

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Install dependencies

```bash
npm install
```

### Development mode

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Loading the Extension

1. Run `npm run build` to build the extension
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `dist` folder

## Project Structure

```
src/
├── background.ts      # Service worker for background tasks
├── main.tsx           # React entry point
├── App.tsx            # Main application component
├── components/        # React components
├── storage.ts         # Chrome storage utilities
├── types.ts           # TypeScript type definitions
├── utils.ts           # Utility functions
├── ai.ts              # AI tag suggestion logic
└── index.css          # Global styles
```

## License

MIT
