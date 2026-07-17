# Spine Preview App - Chi tiết Implementation Plan

## 1. Khởi tạo Project & Setup

### 1.1 Cấu trúc Project
```
spine-preview-app/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Entry point
│   │   └── window.ts      # Window management
│   ├── renderer/          # Electron renderer process
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks
│   │   ├── utils/         # Utilities
│   │   ├── styles/        # Global styles
│   │   └── App.tsx        # Root component
│   ├── shared/            # Shared types & constants
│   └── preload/           # Preload scripts
├── assets/                # Static assets
└── dist/                  # Build output
```

### 1.2 Dependencies cần install
**Core:**
- electron
- electron-builder (for packaging)

**Frontend Framework:**
- react
- react-dom
- typescript

**Build Tools:**
- vite (hoặc webpack)
- electron-vite (recommended)

**UI Libraries (tham khảo từ super-app):**
- antd hoặc material-ui (cho Input, Button, Slider components)
- styled-components hoặc emotion (cho styling)
- lucide-react hoặc @ant-design/icons (icons)

**Spine Runtime:**
- @esotericsoftware/spine-player hoặc pixi-spine
- pixi.js (nếu dùng pixi-spine)

**Utilities:**
- electron-store (lưu settings/recent folders)

---

## 2. Architecture & Data Flow

### 2.1 Main Process (Electron)
**Responsibilities:**
- Tạo và quản lý BrowserWindow
- Handle IPC communication với renderer
- File system operations (đọc folder, list files)
- Window state management

**IPC Channels cần implement:**
- `select-folder`: Mở dialog chọn folder
- `get-spine-files`: Lấy danh sách spine files trong folder
- `read-spine-file`: Đọc nội dung file spine (json, atlas, png)

### 2.2 Renderer Process
**Responsibilities:**
- Render UI components
- Quản lý state (current spine, animation state)
- Spine animation playback
- User interactions

### 2.3 State Management
Không cần Redux/MobX cho app đơn giản này. Dùng:
- React useState/useReducer cho local state
- Context API cho global state (nếu cần)

**Global State cần quản lý:**
```typescript
interface AppState {
  selectedFolder: string | null;
  spineFiles: SpineFile[];
  currentIndex: number;
  isLoading: boolean;
}

interface SpineFile {
  name: string;
  jsonPath: string;
  atlasPath: string;
  imagePaths: string[];
}
```

---

## 3. UI Components Detail

### 3.1 Loading Screen Component
```
┌─────────────────────────────┐
│                             │
│      [Spinner Animation]    │
│                             │
│      Loading...             │
│                             │
└─────────────────────────────┘
```

**Features:**
- Simple centered spinner
- Fade out animation khi load xong
- Duration: ~500ms

### 3.2 Main Page Layout
```
┌─────────────────────────────────────────┐
│                                         │
│  ┌────────────────────────────────┐   │
│  │  📁 Select Animation Folder    │   │
│  └────────────────────────────────┘   │
│                                         │
│  ┌────────────────────────────────┐   │
│  │                                 │   │
│  │     Spine Canvas Area          │   │
│  │     (Centered)                  │   │
│  │                                 │   │
│  └────────────────────────────────┘   │
│                                         │
│  ┌────────────────────────────────┐   │
│  │  [◀] Slider [▶]  1/10         │   │
│  └────────────────────────────────┘   │
│                                         │
│  ┌────────────────────────────────┐   │
│  │  Animation Controls             │   │
│  │  [⏮] [⏸/▶] [⏭] [🔄]          │   │
│  │  Speed: [Slider]                │   │
│  │  Animations: [Dropdown]         │   │
│  │  Skins: [Dropdown]              │   │
│  └────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### 3.3 Component Breakdown

**FolderSelector Component:**
- Button để trigger folder selection dialog
- Display current selected folder path
- Clear button

**SpineCanvas Component:**
- Canvas element để render Spine animation
- Auto-resize theo window
- Background color configurable

**NavigationSlider Component:**
- Previous/Next buttons
- Slider với current index / total count
- Thumbnail preview (optional - phase 2)
- Keyboard shortcuts (arrow keys)

**AnimationControls Component:**
- Play/Pause button
- Previous/Next animation
- Loop toggle
- Speed control (0.5x - 2x)
- Animation dropdown (list all animations)
- Skin dropdown (list all skins)
- Reset to default pose button

---

## 4. Implementation Steps (Chi tiết từng phase)

### Phase 1: Project Setup (Day 1)
**Tasks:**
1. ✅ Initialize Electron + Vite + React + TypeScript project
   ```bash
   npm create @quick-start/electron
   # or
   npm create vite@latest
   ```
2. ✅ Setup project structure (folders)
3. ✅ Install dependencies
4. ✅ Configure TypeScript
5. ✅ Setup ESLint & Prettier
6. ✅ Test basic Electron window launch

**Deliverable:** App mở được và hiển thị "Hello World"

### Phase 2: Main Process & IPC (Day 1-2)
**Tasks:**
1. ✅ Implement window creation với proper config
   - Width: 1200px, Height: 800px
   - Centered, resizable
   - Min size: 800x600
2. ✅ Setup IPC handlers trong main process:
   - `select-folder` handler → open dialog
   - `get-spine-files` handler → scan folder for .json, .atlas files
   - `read-file` handler → read file content
3. ✅ Implement file scanner utility:
   - Tìm tất cả .json files
   - Match với .atlas files cùng tên
   - Validate structure
4. ✅ Test IPC communication

**Deliverable:** Main process có thể chọn folder và return danh sách spine files

### Phase 3: Loading Screen (Day 2)
**Tasks:**
1. ✅ Create LoadingScreen component
2. ✅ Add CSS animations (spinner)
3. ✅ Implement fade-out transition
4. ✅ Add loading state management
5. ✅ Test loading flow

**Deliverable:** Loading screen xuất hiện khi start app, fade out sau khi ready

### Phase 4: Folder Selection UI (Day 2-3)
**Tasks:**
1. ✅ Create FolderSelector component
2. ✅ Integrate với IPC để trigger dialog
3. ✅ Display selected folder path
4. ✅ Handle no folder selected state
5. ✅ Style component (centered, proper spacing)
6. ✅ Add error handling (invalid folder)

**Deliverable:** UI để chọn folder, hiển thị path, handle errors

### Phase 5: Spine Runtime Integration (Day 3-4)
**Tasks:**
1. ✅ Research spine runtime options:
   - Option A: @esotericsoftware/spine-player (official, easier)
   - Option B: pixi-spine (more control, better performance)
2. ✅ Install chosen spine runtime
3. ✅ Create SpineCanvas component
4. ✅ Implement spine loader utility:
   - Load json, atlas, textures
   - Handle loading errors
   - Cache loaded assets
5. ✅ Test rendering một spine animation
6. ✅ Implement cleanup (dispose resources)

**Deliverable:** Có thể load và hiển thị 1 spine animation

### Phase 6: Navigation Slider (Day 4-5)
**Tasks:**
1. ✅ Create NavigationSlider component
2. ✅ Implement Previous/Next functionality
3. ✅ Add slider với current index display
4. ✅ Handle edge cases (first/last item)
5. ✅ Keyboard shortcuts:
   - Arrow Left/Right: prev/next spine
6. ✅ Update SpineCanvas khi switch spine
7. ✅ Add transition/loading state khi switch

**Deliverable:** Có thể navigate giữa các spine files trong folder

### Phase 7: Animation Controls (Day 5-6)
**Tasks:**
1. ✅ Create AnimationControls component
2. ✅ Implement Play/Pause
3. ✅ Implement animation list dropdown:
   - Get available animations từ spine data
   - Switch animation on select
4. ✅ Implement skin list dropdown:
   - Get available skins từ spine data
   - Switch skin on select
5. ✅ Implement speed control (slider 0.5x - 2x)
6. ✅ Implement loop toggle
7. ✅ Add keyboard shortcuts:
   - Space: play/pause
   - R: restart animation
   - L: toggle loop
8. ✅ Display current animation name & time

**Deliverable:** Full control over spine animation playback

### Phase 8: Polish & Bug Fixes (Day 6-7)
**Tasks:**
1. ✅ Center all UI elements properly
2. ✅ Responsive design adjustments
3. ✅ Add loading states cho tất cả async operations
4. ✅ Error handling & user feedback:
   - Toast notifications cho errors
   - Empty states
5. ✅ Performance optimization:
   - Lazy load animations
   - Dispose unused resources
   - Debounce slider changes
6. ✅ Add về recent folders (electron-store)
7. ✅ Testing toàn bộ flow
8. ✅ Fix bugs discovered

**Deliverable:** App hoàn chỉnh, stable, user-friendly

### Phase 9: Build & Distribution (Day 7)
**Tasks:**
1. ✅ Configure electron-builder
2. ✅ Setup app icons
3. ✅ Test build process
4. ✅ Build cho macOS/Windows/Linux
5. ✅ Test built app
6. ✅ Write README với usage instructions

**Deliverable:** Distributable app packages

---

## 5. Technical Decisions

### 5.1 Spine Runtime Choice
**Recommendation: @esotericsoftware/spine-player**
- ✅ Official, well-maintained
- ✅ Easier setup
- ✅ Built-in UI controls (có thể customize)
- ✅ Good documentation
- ❌ Less flexible than pixi-spine

**Alternative: pixi-spine**
- ✅ More control over rendering
- ✅ Better performance cho complex scenes
- ✅ Integrate với PixiJS ecosystem
- ❌ More complex setup
- ❌ Need to build controls from scratch

**Decision:** Start with spine-player, migrate to pixi-spine nếu cần performance.

### 5.2 Build Tool
**Recommendation: electron-vite**
- Fast HMR
- TypeScript support out of the box
- Better DX than webpack

### 5.3 Styling Approach
**Recommendation: styled-components + Ant Design**
- Ant Design cho common components (Button, Input, Slider)
- styled-components cho custom styling
- CSS variables cho theming

---

## 6. File Structure Details

### 6.1 Key Files to Create

**src/main/index.ts**
```typescript
// Electron main process entry
// - Create window
// - Setup IPC handlers
// - App lifecycle management
```

**src/main/ipc-handlers.ts**
```typescript
// All IPC handler implementations
// - selectFolder
// - getSpineFiles
// - readFile
```

**src/renderer/App.tsx**
```typescript
// Root component
// - Loading screen logic
// - Main page routing
// - Global state
```

**src/renderer/components/FolderSelector.tsx**
**src/renderer/components/SpineCanvas.tsx**
**src/renderer/components/NavigationSlider.tsx**
**src/renderer/components/AnimationControls.tsx**

**src/renderer/hooks/useSpineLoader.ts**
```typescript
// Custom hook for loading spine files
// - Load json, atlas, textures
// - Handle errors
// - Return spine data
```

**src/renderer/hooks/useSpineAnimation.ts**
```typescript
// Custom hook for animation control
// - Play, pause, stop
// - Change animation
// - Change skin
// - Speed control
```

**src/renderer/utils/spineFileScanner.ts**
```typescript
// Utility to find matching spine files
// - Match .json with .atlas
// - Find associated images
// - Validate structure
```

---

## 7. Testing Checklist

### Unit Tests
- [ ] File scanner utility
- [ ] Spine file validator
- [ ] IPC handlers

### Integration Tests
- [ ] Folder selection flow
- [ ] Spine loading flow
- [ ] Navigation between files
- [ ] Animation controls

### Manual Testing
- [ ] Load folder với multiple spine files
- [ ] Navigate prev/next
- [ ] Play/pause animations
- [ ] Change animations
- [ ] Change skins
- [ ] Speed control
- [ ] Keyboard shortcuts
- [ ] Window resize
- [ ] Invalid folder handling
- [ ] Corrupted spine file handling
- [ ] Performance với large files

---

## 8. Future Enhancements (Post MVP)

### Phase 2 Features:
- [ ] Thumbnail grid view
- [ ] Search/filter spine files
- [ ] Bookmarks/favorites
- [ ] Export animation as GIF/video
- [ ] Side-by-side comparison mode
- [ ] Dark/light theme toggle
- [ ] Custom background color picker
- [ ] Zoom controls for canvas
- [ ] Drag & drop folder support
- [ ] Recent folders history
- [ ] Spine file information panel (size, animations count, etc.)

---

## 9. References & Resources

### Documentation to Read:
1. Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
2. Spine Player: http://esotericsoftware.com/spine-player
3. Electron Vite: https://electron-vite.org/

### Super-app References:
- Check `spine-review` module structure
- UI components style guide
- Animation control patterns
- Error handling patterns

---

## 10. Estimated Timeline

**Total: 7 days**

- Day 1: Setup + Main Process (Phase 1-2)
- Day 2: Loading Screen + Folder Selection (Phase 3-4)
- Day 3-4: Spine Integration (Phase 5)
- Day 4-5: Navigation (Phase 6)
- Day 5-6: Controls (Phase 7)
- Day 6-7: Polish + Build (Phase 8-9)

**Buffer: +2 days** for unexpected issues

---

## 11. Success Criteria

✅ App mở được và stable
✅ Có thể chọn folder chứa spine files
✅ Hiển thị được spine animation
✅ Navigate được giữa các spine files
✅ Control được animation (play/pause, speed, switch animation/skin)
✅ UI centered và đẹp mắt
✅ Handle errors gracefully
✅ Performance acceptable (60fps animation)
✅ Build được distributable package

---

## 12. Known Challenges & Solutions

### Challenge 1: Spine Runtime trong Electron
**Problem:** Web-based spine runtimes có thể có issues với Electron's renderer process
**Solution:** 
- Test thoroughly trong Electron environment
- Có thể cần adjust Content Security Policy
- Use nodeIntegration: false + preload script

### Challenge 2: Large File Loading
**Problem:** Large spine files có thể làm UI freeze
**Solution:**
- Load assets trong Web Worker (nếu possible)
- Show loading progress
- Implement cancellation
- Cache loaded assets

### Challenge 3: Cross-platform Path Handling
**Problem:** Windows vs Mac/Linux path differences
**Solution:**
- Use Node's `path` module
- Test trên cả 3 platforms
- Use path.join() thay vì string concatenation

---

## Next Step: Start Implementation

Bắt đầu với Phase 1:
```bash
# Initialize project
npm create @quick-start/electron spine-preview-app
cd spine-preview-app
npm install
```

Sau đó follow từng phase theo thứ tự.
