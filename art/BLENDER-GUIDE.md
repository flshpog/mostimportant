# editing the board in blender: a cheat sheet

Open `art/board.blend` for the main board. Yoshi's Island (the merge board) is
`art/board-yoshi.blend` and the underworld is `art/board-underworld.blend`. Save often (Ctrl+S). If something goes wrong, Ctrl+Z undoes it,
and the last committed version is always in git.

## getting around

| | |
|---|---|
| orbit | hold middle mouse and drag |
| pan | Shift + middle mouse drag |
| zoom | scroll wheel |
| look at the selected thing | `numpad .` (or View → Frame Selected) |
| see through the camera | `numpad 0` |
| see the real colours | press `Z`, choose **Material Preview** |

No middle mouse button (laptop)? Edit → Preferences → Input → turn on **Emulate 3 Button
Mouse**, then Alt + left drag orbits.

## moving things

Click an object to select it (Shift+click for more), then press a key and move the mouse:

| key | does |
|---|---|
| `G` | move (then `X` or `Y` to lock to one direction) |
| `R` | rotate (then `Z` to spin it around upright) |
| `S` | scale |
| `Shift+D` | duplicate (then move it) |
| `X` | delete |
| right click or `Esc` | cancel while moving |

Click to confirm. `H` hides the selection, `Alt+H` shows everything again.

## what's in the scene (the list at the top right, the "outliner")

| collection | what it is | ok to edit? |
|---|---|---|
| **Scenery** (Trees, Bushes, Rocks, Flowers, Grass, Mushrooms, Fences) | decoration | yes, move/add/delete freely |
| **Landmarks** (Shops, Signposts, Start) | buildings by the board | yes, but keep them off the paths |
| **Sky** (clouds, floating islets) | background | yes |
| **Terrain**, **Water** | the island, river, waterfalls | careful: these are generated |
| **Board** (Paths, Spaces, Bridges) | the game board | **don't move** these. they come from `board.json`; ask Claude to change the layout |
| **Kit** (hidden) | the master copy of every prop | don't touch |

Every tree, bush, rock etc. is a copy of a master in the Kit, so they're light. Need another
tree? Select an existing one, `Shift+D`, move it.

## when you're done

Save, then tell Claude what you changed. Claude re-exports the board for the website and
re-renders the Discord background from your version.
