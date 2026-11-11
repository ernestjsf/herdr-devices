// Holds the frames the Devices mod's screen view writes (view-N-M.jpg). Herdr refreshes an image
// under mods/ when its file changes, and a write inside the Devices mod's own folder would
// reload that mod, so the frames live here. It shows nothing.
import { View, div } from "gpui-kit";

export default class DevicesScreen extends View {
  render() { return div(); }
}
