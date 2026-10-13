/** Header control: page theme (system/light/dark) and the viewer's code theme. */
import { CODE_THEMES, COLOR_SCHEMES, setThemePref, themePref } from "../lib/theme";

export function ThemePicker() {
  const pref = themePref.value;
  return (
    <div class="sb-theme-picker">
      <label class="sb-visually-hidden" for="sb-theme-scheme">
        Page theme
      </label>
      <select
        id="sb-theme-scheme"
        class="sb-select sb-theme-picker__select"
        value={pref.scheme}
        title="Page theme"
        onChange={(e) => {
          const id = e.currentTarget.value;
          const scheme = COLOR_SCHEMES.find((s) => s.id === id);
          if (scheme) setThemePref({ scheme: scheme.id });
        }}
      >
        {COLOR_SCHEMES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <label class="sb-visually-hidden" for="sb-theme-code">
        Code theme
      </label>
      <select
        id="sb-theme-code"
        class="sb-select sb-theme-picker__select"
        value={pref.code}
        title="Code theme"
        onChange={(e) => setThemePref({ code: e.currentTarget.value })}
      >
        {CODE_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
