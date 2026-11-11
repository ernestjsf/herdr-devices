// The agent pill, on a row and on the screen's bar. Shaped like the app tag: an icon for the
// relationship (lock claimed, link driven, triangle mismatch), the tone for liveness (`working`
// driving, `blocked` its agent is, else muted), the holder's program icon, then the label
// (truncated), the idle text in `dim` and, on a claim, a × that releases it (`release`, called with
// the click's cx); a claim pill gives way (its label truncates) before what is beside it does.
// With a click (the holder's or the first driver's terminal) it brightens under the pointer.
import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";

const icon = (name) => `mods/devices/icons/${name}.svg`;

export function agentTag({ icon: ic, label, tone, tip, focus, terminal, program: p, idle: since, release: releasable }, id, t, max, release) {
  const idle = tone === "idle", color = idle ? t.muted : t[tone];
  return h_flex().id(id).when(!releasable, (el) => el.flex_none()).min_w(0).max_w(max).truncate().items_center().gap(3).px(5).h(16).rounded(4)
    .bg(idle ? t.raised : t[tone] + "1f").text_size(10.5).font_medium().text_color(color)
    .when(Boolean(focus), (el) => el
      .hover((s) => s.bg(idle ? t.hover : t[tone] + "40").text_color(idle ? t.foreground : color))
      .on_click((_e, cx) => { cx.stop_propagation(); run(focus, { terminal }); }))
    .tooltip(tip)
    .child(svg(icon(ic)).size(10).flex_none())
    .when(Boolean(p), (el) => el.child(p.tint ? svg(p.icon).size(10).flex_none() : image(p.icon).w(10).h(10).flex_none()))
    .when(Boolean(label), (el) => el.child(div().min_w(0).truncate().child(label)))
    .when(Boolean(since), (el) => el.child(div().flex_none().text_color(t.dim).child(since)))
    // Its own hit area: the release, never the pill's focus or the row's click.
    .when(Boolean(releasable), (el) => el.child(div().id(`${id}-release`).flex_none().px(2).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).tooltip("Release claim")
      .on_click((_e, cx) => { cx.stop_propagation(); release(cx); }).child("×")));
}
