"use client";
import { useState } from "react";
import { api } from "./actions";
// 어종은 운영 목록에서만 고른다. 목록에 없으면 회원이 바로 추가하고, 추가한 어종은 모두가 고를 수 있다.
export function SpeciesPicker({
  label,
  name,
  options,
  selected = [],
  multiple = false,
  hint,
}: {
  label: string;
  name: string;
  options: string[];
  selected?: string[];
  multiple?: boolean;
  hint?: string;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [added, setAdded] = useState<string[]>([]),
    [value, setValue] = useState(
      !multiple && options.includes(selected[0]) ? selected[0] : "",
    ),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const all = [...options, ...added.filter((s) => !options.includes(s))];
  async function add() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { name: saved } = await api("taxonomy/species", { name: draft });
      setAdded((a) => (a.includes(saved) ? a : [...a, saved]));
      if (!multiple) setValue(saved);
      else
        setPicked((current) =>
          current.includes(saved) ? current : [...current, saved],
        );
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const adder = (
    <>
      <div className="row">
        <input
          aria-label={`${label}: 목록에 없는 어종 직접 추가`}
          placeholder="목록에 없으면 직접 추가"
          value={draft}
          maxLength={30}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중의 Enter는 글자 확정이므로 추가로 처리하지 않는다.
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            add();
          }}
        />
        <button
          type="button"
          className="button secondary"
          disabled={busy || !draft.trim()}
          onClick={add}
        >
          {busy ? "추가 중…" : "추가"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  if (!multiple)
    return (
      <div className="species-picker">
        <label>
          {label}
          <select
            name={name}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">어종을 선택해주세요</option>
            {all.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {adder}
      </div>
    );
  return (
    <fieldset>
      <legend>{label}</legend>
      {hint && <p className="form-note">{hint}</p>}
      <div className="check-grid">
        {all.map((s) => (
          <label className="check" key={s}>
            <input
              type="checkbox"
              name={name}
              value={s}
              checked={picked.includes(s)}
              onChange={(e) =>
                setPicked((current) =>
                  e.target.checked
                    ? [...current, s]
                    : current.filter((item) => item !== s),
                )
              }
            />
            {s}
          </label>
        ))}
      </div>
      {adder}
    </fieldset>
  );
}
