# Video Provider UI Usage Guide

## Overview

The video generation UI now supports **5 models across 3 providers**:
- **Kling** (1 model): Kling 3.0
- **Sora2** (2 models): Standard, Pro
- **Veo** (2 models): Quality, Fast

All providers share a unified UI with adaptive parameters.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ VideoGenNode                                                │
│                                                             │
│ [Prompt Input Area]                                        │
│ [Frame Selection Area]                                     │
│                                                             │
│ ┌─ Controls ─────────────────────────────────────────────┐ │
│ │ [Model Chip] [Params Chip] [Other Params] │ [Generate] │ │
│ │ ├─ Kling 3.0    ├─ 16:9               ├─ Audio      │ │ │
│ │ │  Kling AI      │  · 5s               ├─ Seed       │ │ │
│ │ │                │                     └─ Mode       │ │ │
│ │ └─ [Click opens panel]                └─ Elements   │ │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Model Selection Panel

**Click the Model Chip to open:**

```
┌─ Select Model ────────────────┐
│                               │
│ Provider                      │
│ ┌─────┬─────┬─────┬─────┐   │
│ │Kling│Sora2│ Veo │     │   │
│ └─────┴─────┴─────┴─────┘   │
│     ↑ Active                 │
│                               │
│ Model                         │
│ ┌───────────┐ ┌───────────┐ │
│ │ Kling 3.0 │ │ (other)   │ │
│ └───────────┘ └───────────┘ │
│     ↑ Active                 │
└───────────────────────────────┘
```

**Features:**
- **Provider Tabs**: Switch between Kling, Sora2, Veo
- **API Key Check**: Blocks switch if key is missing
- **Model Buttons**: Select specific model within provider
- **Auto-Close**: Closes after selection

---

## Parameters Panel

**Click the Params Chip to open:**

### Kling Parameters
```
┌─ Video Parameters ────────────┐
│                               │
│ Duration                      │
│ ┌─────┬─────┬─────┬─────┐   │
│ │ 3s  │ 5s  │ 10s │ 15s │   │
│ └─────┴─────┴─────┴─────┘   │
│                               │
│ Aspect Ratio                  │
│ ┌─────┬─────┬─────┬─────┐   │
│ │16:9 │ 9:16│ 1:1 │     │   │
│ └─────┴─────┴─────┴─────┘   │
└───────────────────────────────┘
```

### Sora2 Parameters
```
┌─ Video Parameters ────────────┐
│                               │
│ Duration                      │
│ ┌─────┬─────┐                │
│ │ 10s │ 15s │                │
│ └─────┴─────┘                │
│                               │
│ Aspect Ratio                  │
│ ┌─────┬─────┐                │
│ │16:9 │ 9:16│                │
│ └─────┴─────┘                │
└───────────────────────────────┘
```

### Veo Parameters
```
┌─ Video Parameters ────────────┐
│                               │
│ (No Duration Control)         │
│                               │
│ Aspect Ratio                  │
│ ┌─────┬─────┬──────┐         │
│ │16:9 │ 9:16│ Auto │         │
│ └─────┴─────┴──────┘         │
└───────────────────────────────┘
```

**Features:**
- **Dynamic Options**: Options change based on selected model
- **Visual Preview**: Aspect ratio shows visual rectangle
- **Grid Layout**: Clean, consistent design

---

## Other Parameters Panel

**Click the "Other Params" chip to open:**

### Kling Other Params
```
┌─ Other Parameters ────────────┐
│                               │
│ ┌─ Enable Audio ───────────┐ │
│ │ Audio          [✓]       │ │
│ └──────────────────────────┘ │
│                               │
│ ┌─ Mode ───────────────────┐ │
│ │ Mode      [Standard ▼]   │ │
│ │ (or Professional)        │ │
│ └──────────────────────────┘ │
│                               │
│ ┌─ Multi Shots ────────────┐ │
│ │ Multi-shots   [ ]        │ │
│ └──────────────────────────┘ │
│                               │
│ ┌─ Kling Elements ─────────┐ │
│ │ (Advanced editor)        │ │
│ └──────────────────────────┘ │
└───────────────────────────────┘
```

### Sora2 Other Params
```
(No Other Params Panel)
- Duration directly maps to frame count
- No additional configuration needed
```

### Veo Other Params
```
┌─ Other Parameters ────────────┐
│                               │
│ ┌─ Seed ───────────────────┐ │
│ │ Seed      [42000]        │ │
│ │ Range: 10000-99999       │ │
│ └──────────────────────────┘ │
└───────────────────────────────┘
```

**Features:**
- **Provider-Specific**: Only shows relevant params
- **Validation**: Seed auto-clamps to valid range
- **Help Text**: Descriptions for complex options

---

## API Key Configuration

### Step 1: Open Settings
```
Menu → Settings → Providers
```

### Step 2: Configure KIE Key
```
┌─ Provider API Keys ──────────────────┐
│                                      │
│ KIE                                  │
│ ┌────────────────────────────────┐  │
│ │ sk-abc123...                  │  │
│ └────────────────────────────────┘  │
│                                      │
│ Kling                                │
│ ┌────────────────────────────────┐  │
│ │ (optional - falls back to KIE) │  │
│ └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**Key Points:**
- **One Key for All**: Setting "KIE" enables Kling, Sora2, Veo
- **Provider Fallback**: Can set individual keys if needed
- **Validation**: UI checks key before allowing provider switch

---

## Workflow Examples

### Example 1: Generate with Sora2
1. Create VideoGenNode
2. Connect image nodes for start/end frames
3. Click **Model Chip** → Select "Sora2" → Select "Standard"
4. Click **Params Chip** → Select 10s, 16:9
5. Enter prompt
6. Click **Generate**

### Example 2: Generate with Veo + Seed
1. Create VideoGenNode
2. Connect image nodes
3. Click **Model Chip** → Select "Veo" → Select "Quality"
4. Click **Params Chip** → Select 9:16, (no duration)
5. Click **Other Params** → Enter seed 50000
6. Enter prompt
7. Click **Generate**

### Example 3: Switch Between Providers
1. Start with Kling model
2. Click **Model Chip**
3. Click "Sora2" provider tab
4. If no API key → Shows dialog "API key required"
5. Click "Go Configure" → Opens Settings
6. Set KIE API key
7. Return to node → Now can select Sora2

---

## Visual Indicators

### Active States
- **Blue Border**: Selected provider/model/option
- **Blue Background**: Active toggle/checkbox
- **Accent Color**: Generate button (when ready)

### Disabled States
- **Gray Text**: Unavailable options
- **Muted Button**: Missing API key
- **Tooltip**: Hover for details

### Error States
- **Red Text**: Validation errors
- **Red Border**: Invalid input
- **Error Message**: Below controls

---

## Keyboard Shortcuts

**In Model/Params Panels:**
- `ESC` - Close panel
- `Enter` - Select option (if focused)
- `Tab` - Navigate between options

**In Prompt Area:**
- `@` - Insert image reference (if images available)
- `Arrow Up/Down` - Navigate image picker
- `Enter/Tab` - Select image reference

---

## Tips & Best Practices

### 1. API Key Management
- ✅ **Do**: Set KIE API key once for all providers
- ❌ **Don't**: Set individual keys unless you need different quotas

### 2. Parameter Selection
- ✅ **Do**: Use appropriate duration for content type
  - Short clips → 3s-5s (Kling)
  - Medium clips → 10s (Sora2, Kling)
  - Long clips → 15s (Sora2, Kling)
- ❌ **Don't**: Expect duration control with Veo (system-determined)

### 3. Seed Usage (Veo Only)
- ✅ **Do**: Use same seed for reproducible results
- ✅ **Do**: Use different seeds for variations
- ❌ **Don't**: Use seeds outside 10000-99999 range (auto-clamped)

### 4. Model Selection
- **Kling**: Best for multi-shot, element control
- **Sora2 Standard**: Fast, good quality
- **Sora2 Pro**: Higher quality, slower
- **Veo Quality**: Best quality, reproducible (seed)
- **Veo Fast**: Quick iterations

---

## Troubleshooting

### "API key required" Dialog
**Problem**: Trying to switch to provider without API key
**Solution**: Click "Go Configure" and set KIE API key in Settings

### Parameters Don't Update
**Problem**: Selected new model but old params still shown
**Solution**: Params update on model change - try refreshing or closing/reopening panel

### "Other Params" Chip Not Visible
**Reason**: Selected model has no additional parameters (e.g., Sora2 Standard)
**Expected**: This is normal - chip only appears when needed

### Generation Fails
**Check**:
1. API key is set
2. Prompt is not empty
3. At least one frame selected (for image-to-video)
4. Valid seed range for Veo (10000-99999)

---

## Quick Reference

| Provider | Models | Duration | Seed | Special |
|----------|--------|----------|------|---------|
| **Kling** | 1 | 3s-15s | ❌ | Audio, Mode, Multi-shots, Elements |
| **Sora2** | 2 | 10s-15s | ❌ | Frame count mapping |
| **Veo** | 2 | Auto | ✅ | Auto aspect ratio |

**API Key**: Single "KIE" key works for all providers

**UI Components**:
- Model Chip → Select provider & model
- Params Chip → Select duration & aspect ratio
- Other Params Chip → Provider-specific features
- Generate Button → Start video generation
