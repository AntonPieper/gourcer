# Gourcer Context

Gourcer is a browser-native Gource-style source history visualizer. It turns a
Git-derived sidecar dataset into an animated graph where files, semantic groups,
languages, and contributors move through time.

## Domain Terms

**Sidecar Data**
The JSON input that describes commits, file changes, language metadata,
semantic groups, captions, background colors, and visualization settings. The
app loads sidecar data directly rather than shelling out to Git at runtime.

**Timeline**
The time span from the first to the last sidecar change. Scrubbing, playback,
captions, legends, contributor pulses, and graph animation all derive from the
Timeline.

**Change Pulse**
A visible contribution event at one timeline instant. A pulse has a contributor,
a file node, a change kind, and a beam color: green for additions, orange for
modifications, and red for deletions.

**Pulse Window**
The configurable look-ahead/look-behind period used for contributor presence.
Contributors fade out when they have no pulse inside the next Pulse Window and
anticipate their next pulse by drifting toward the target node.

**Semantic Group**
A named cluster of related files. Semantic groups render as smooth adaptive
background shapes with a title and a group color.

**Language Legend**
The real-time set of programming languages active near the current timeline
position, including canonical language names, colors, file counts, and SVG
icons.

**Graph Layout**
The deterministic world positions for semantic groups, file nodes, and
contributors at a given timeline position. The renderer may interpolate these
positions, but the layout module owns the target state.

**Caption**
Timeline text that appears over the visualization for a time range, usually to
explain major events in the repository story.
