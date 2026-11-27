#!/usr/bin/env python3
"""問題データ（assets/data/<exam>.json）の形式をチェックする。

使い方: python3 tools/validate.py
エラーがあれば一覧を表示して終了コード 1 を返す。
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
REQUIRED = ["id", "domain", "skill", "level", "type", "stem", "options", "point"]
LONG_RATIO = 1.2       # 正解が誤答の最長の何倍を超えたらエラーにするか
LONGEST_SHARE = 0.35   # 正解が一番長い問題の割合の上限（4択の偶然は約25%）


def check_exam(exam_id, exam, errors, plus=False):
    """通常の問題データを確認する。plus=True はプラスONEチェック（難易度なし、用語集へのリンクが必須）。"""
    name = f"{exam_id}-plus" if plus else exam_id
    path = DATA / f"{name}.json"
    if not path.exists():
        if not plus:
            errors.append(f"{exam_id}: {path.name} がありません")
        return None
    try:
        questions = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{name}: JSON の形式が正しくありません: {e}")
        return None

    domains = {d["id"]: d for d in exam["domains"]}
    seen = set()
    for i, q in enumerate(questions):
        where = f"{name}[{i}] {q.get('id', '?')}"
        for key in REQUIRED + (["learn"] if plus else []):
            if key not in q or q[key] in ("", None, []):
                errors.append(f"{where}: {key} がありません")
        qid = q.get("id")
        if qid in seen:
            errors.append(f"{where}: id が重複しています")
        seen.add(qid)
        if q.get("domain") not in domains:
            errors.append(f"{where}: domain '{q.get('domain')}' は exams.json にありません")
        elif q.get("skill") not in domains[q["domain"]]["skills"]:
            errors.append(f"{where}: skill '{q.get('skill')}' は分野 {q['domain']} のスキルにありません")
        if q.get("level") not in (1, 2, 3):
            errors.append(f"{where}: level は 1〜3 にしてください")
        opts = q.get("options") or []
        if not 3 <= len(opts) <= 6:
            errors.append(f"{where}: 選択肢は 3〜6 個にしてください（{len(opts)}個）")
        if plus and (q.get("type") != "single" or len(opts) != 4):
            errors.append(f"{where}: プラスONEチェックは四肢択一（single・選択肢4個）にしてください")
        for j, o in enumerate(opts):
            for key in ("text", "correct", "why"):
                if key not in o or o[key] in ("", None):
                    errors.append(f"{where}: 選択肢 {j} に {key} がありません")
        n_correct = sum(1 for o in opts if o.get("correct") is True)
        if q.get("type") == "single" and n_correct != 1:
            errors.append(f"{where}: single なのに正解が {n_correct} 個です")
        if q.get("type") == "multi" and not (2 <= n_correct < len(opts)):
            errors.append(f"{where}: multi の正解は 2 個以上（選択肢の数未満）にしてください")
        if q.get("type") not in ("single", "multi"):
            errors.append(f"{where}: type は single か multi にしてください")
        # 選択肢の長さの偏り：正解だけが目立って長い問題（コードの ` は数えない）
        cor = [len(o.get("text", "").replace("`", "")) for o in opts if o.get("correct") is True]
        wrong = [len(o.get("text", "").replace("`", "")) for o in opts if o.get("correct") is not True]
        if cor and wrong and min(cor) > max(wrong) * LONG_RATIO:
            errors.append(f"{where}: 正解の選択肢が誤答より目立って長い（{min(cor)}文字 / 誤答の最長 {max(wrong)}文字）")
        for key in ("diagram", "learn"):
            if q.get(key):
                path_part, _, anchor = q[key].partition("#")
                target = ROOT / path_part
                if target.is_dir():
                    target = target / "index.html"
                if not target.exists():
                    errors.append(f"{where}: {key} のファイル {path_part} がありません")
                elif anchor and f'id="{anchor}"' not in target.read_text(encoding="utf-8"):
                    errors.append(f"{where}: {path_part} に見出し #{anchor} がありません")
    return questions


def is_longest(q):
    """正解の選択肢が、どの誤答よりも長いか。"""
    lens = [(len(o["text"].replace("`", "")), o.get("correct") is True) for o in q.get("options", [])]
    cor = [n for n, c in lens if c]
    wrong = [n for n, c in lens if not c]
    return bool(cor and wrong) and min(cor) > max(wrong)


ABSOLUTE_WORDS = ["すべて", "必ず", "絶対", "だけ", "常に", "一切", "何でも", "決して"]


def check_challenge(exam_id, exam, errors):
    """最難関（「すべて選べ」形式）の問題データを確認する。"""
    path = DATA / f"{exam_id}-challenge.json"
    if not path.exists():
        return
    try:
        qs = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{exam_id}-challenge: JSON の形式が正しくありません: {e}")
        return
    domains = {d["id"]: d for d in exam["domains"]}
    seen = set()
    true_lens, false_lens, true_abs, false_abs = [], [], [], []
    asks = Counter()
    for i, q in enumerate(qs):
        where = f"{exam_id}-challenge[{i}] {q.get('id', '?')}"
        for key in ["id", "domain", "skills", "ask", "type", "stem", "options", "point"]:
            if not q.get(key):
                errors.append(f"{where}: {key} がありません")
        if q.get("id") in seen:
            errors.append(f"{where}: id が重複しています")
        seen.add(q.get("id"))
        if q.get("type") != "select-all":
            errors.append(f"{where}: type は select-all にしてください")
        if q.get("ask") not in ("correct", "incorrect"):
            errors.append(f"{where}: ask は correct か incorrect にしてください")
        asks[q.get("ask")] += 1
        d = domains.get(q.get("domain"))
        if not d:
            errors.append(f"{where}: domain '{q.get('domain')}' は exams.json にありません")
        else:
            for s in q.get("skills") or []:
                if s not in d["skills"]:
                    errors.append(f"{where}: skill '{s}' は分野 {q['domain']} のスキルにありません")
        if len(q.get("stem", "")) < 200:
            errors.append(f"{where}: 問題文が短すぎます（{len(q.get('stem', ''))}字。200字以上）")
        opts = q.get("options") or []
        if not 5 <= len(opts) <= 7:
            errors.append(f"{where}: 選択肢は 5〜7 個にしてください（{len(opts)}個）")
        for j, o in enumerate(opts):
            for key in ("text", "why", "src"):
                if not o.get(key):
                    errors.append(f"{where}: 選択肢 {j} に {key} がありません")
            if not isinstance(o.get("fact"), bool):
                errors.append(f"{where}: 選択肢 {j} の fact は true か false にしてください")
                continue
            n = len(o.get("text", "").replace("`", ""))
            has_abs = any(w in o.get("text", "") for w in ABSOLUTE_WORDS)
            (true_lens if o["fact"] else false_lens).append(n)
            (true_abs if o["fact"] else false_abs).append(has_abs)
        pick = sum(1 for o in opts if (q.get("ask") == "correct") == (o.get("fact") is True))
        if not 2 <= pick <= len(opts) - 1:
            errors.append(f"{where}: 選ぶべき選択肢は2個以上・全部未満にしてください（{pick}個）")
        if not isinstance(q.get("point"), list):
            errors.append(f"{where}: point は重要事項の配列にしてください")
        aim = q.get("aim")
        if aim is not None or exam_id == "ccar-p":
            if not isinstance(aim, dict) or not aim.get("check") or not aim.get("lesson"):
                errors.append(f"{where}: aim（check と lesson）がありません")
        if q.get("learn"):
            path_part, _, anchor = q["learn"].partition("#")
            target = ROOT / path_part
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                errors.append(f"{where}: learn のファイル {path_part} がありません")
            elif anchor and f'id="{anchor}"' not in target.read_text(encoding="utf-8"):
                errors.append(f"{where}: {path_part} に見出し #{anchor} がありません")

    if not qs:
        return
    by_domain = Counter(q.get("domain") for q in qs)
    print(f"{exam['code']} 最難関: {len(qs)}問")
    print("  " + " / ".join(f"{d['ja']} {by_domain[d['id']]}" for d in exam["domains"]))
    mean = lambda xs: sum(xs) / len(xs) if xs else 0
    rate = lambda xs: sum(xs) / len(xs) if xs else 0
    print(f"  問い方: 正しいもの {asks['correct']} / 誤っているもの {asks['incorrect']}")
    print(f"  記述の平均の長さ: 正しい {mean(true_lens):.0f}字 / 誤り {mean(false_lens):.0f}字")
    print(f"  言い切る言葉を含む割合: 正しい {rate(true_abs):.0%} / 誤り {rate(false_abs):.0%}")
    if true_lens and false_lens and abs(mean(true_lens) - mean(false_lens)) / max(mean(true_lens), mean(false_lens)) > 0.15:
        errors.append(f"{exam_id}-challenge: 正しい記述と誤りの記述の平均の長さが 15% 以上ずれています")
    if true_abs and false_abs and abs(rate(true_abs) - rate(false_abs)) > 0.12:
        errors.append(f"{exam_id}-challenge: 言い切る言葉の頻度が、正しい記述と誤りの記述で偏っています")


def main():
    exams = json.loads((DATA / "exams.json").read_text(encoding="utf-8"))
    errors = []
    for exam_id, exam in exams.items():
        check_challenge(exam_id, exam, errors)
        plus = check_exam(exam_id, exam, errors, plus=True)
        if plus is not None:
            by_domain = Counter(q.get("domain") for q in plus)
            print(f"{exam['code']} プラスONEチェック: {len(plus)}問　" + " / ".join(f"{d['ja']} {by_domain[d['id']]}" for d in exam["domains"]))
            if plus and sum(is_longest(q) for q in plus) / len(plus) > LONGEST_SHARE:
                errors.append(f"{exam_id}-plus: 正解が一番長い問題が多すぎます（長さで正解を推測できてしまいます）")
        qs = check_exam(exam_id, exam, errors)
        if qs is None:
            continue
        by_domain = Counter(q.get("domain") for q in qs)
        by_level = Counter(q.get("level") for q in qs)
        by_type = Counter(q.get("type") for q in qs)
        print(f"{exam['code']}: {len(qs)}問")
        for d in exam["domains"]:
            share = by_domain[d["id"]] / len(qs) * 100 if qs else 0
            print(f"  {d['ja']:<20} {by_domain[d['id']]:>3}問 ({share:4.1f}%)  配点 {d['weight']}%")
        print(f"  難易度: 基礎 {by_level[1]} / 標準 {by_level[2]} / 応用 {by_level[3]}　形式: 単一 {by_type['single']} / 複数 {by_type['multi']}")
        share = sum(is_longest(q) for q in qs) / len(qs) if qs else 0
        print(f"  正解が一番長い問題: {share:.0%}（上限 {LONGEST_SHARE:.0%}）")
        if share > LONGEST_SHARE:
            errors.append(f"{exam_id}: 正解が一番長い問題が {share:.0%} あり、長さで正解を推測できてしまいます")
    if errors:
        print("\nエラー:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("\nOK: エラーはありません")


if __name__ == "__main__":
    main()
