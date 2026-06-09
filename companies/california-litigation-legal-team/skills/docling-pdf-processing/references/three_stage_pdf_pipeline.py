#!/usr/bin/env python3
"""Three-stage, page-complete PDF extraction pipeline.

Stage 1: accept coherent existing PDF text.
Stage 2: OCR remaining pages with Azure Document Intelligence.
Stage 3: render low-confidence Azure pages for vision-LLM correction.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pypdf import PdfReader, PdfWriter


AZURE_API_VERSION = "2024-11-30"
AZURE_MODEL = "prebuilt-layout"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def normalized_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\x00", "").splitlines()).strip()


def direct_text_metrics(text: str) -> dict:
    tokens = text.split()
    token_count = len(tokens)
    alpha_tokens = sum(
        bool(re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", token)) for token in tokens
    )
    weird_tokens = sum(
        sum(not char.isalnum() for char in token) > max(2, len(token) * 0.25)
        for token in tokens
    )
    return {
        "characters": len(text),
        "words": token_count,
        "alpha_token_fraction": round(alpha_tokens / max(1, token_count), 4),
        "weird_token_fraction": round(weird_tokens / max(1, token_count), 4),
    }


def accept_direct_text(metrics: dict) -> tuple[bool, list[str]]:
    reasons = []
    if metrics["characters"] < 500:
        reasons.append("fewer_than_500_characters")
    if metrics["words"] < 75:
        reasons.append("fewer_than_75_words")
    if metrics["alpha_token_fraction"] < 0.50:
        reasons.append("low_word_coherence")
    if metrics["weird_token_fraction"] > 0.05:
        reasons.append("suspicious_token_encoding")
    return not reasons, reasons


def prepare(args: argparse.Namespace) -> int:
    source = args.pdf.resolve()
    root = args.output.resolve()
    direct_dir = root / "stage1_direct" / "pages"
    batch_dir = root / "stage2_azure" / "input_batches"
    direct_dir.mkdir(parents=True, exist_ok=True)
    batch_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(source), strict=False)
    pages = []
    azure_source_pages = []

    for source_page, page in enumerate(reader.pages, 1):
        error = None
        try:
            text = normalized_text(page.extract_text() or "")
        except Exception as exc:
            text = ""
            error = f"{type(exc).__name__}: {exc}"
        metrics = direct_text_metrics(text)
        accepted, reasons = accept_direct_text(metrics)
        if error:
            accepted = False
            reasons.append("pdf_text_extraction_error")

        route = "direct" if accepted else "azure"
        record = {
            "source_page": source_page,
            "route": route,
            "status": "accepted" if accepted else "pending",
            "direct_metrics": metrics,
            "routing_reasons": reasons,
            "error": error,
        }
        pages.append(record)

        if accepted:
            (direct_dir / f"source_page_{source_page:04d}.md").write_text(
                f"<!-- source-page: {source_page}; method: direct -->\n\n{text}\n",
                encoding="utf-8",
            )
        else:
            azure_source_pages.append(source_page)

    batch_records = []
    for batch_number, start in enumerate(
        range(0, len(azure_source_pages), args.azure_batch_size), 1
    ):
        source_pages = azure_source_pages[start : start + args.azure_batch_size]
        writer = PdfWriter()
        for source_page in source_pages:
            writer.add_page(reader.pages[source_page - 1])
        pdf_path = batch_dir / f"batch_{batch_number:04d}.pdf"
        with pdf_path.open("wb") as handle:
            writer.write(handle)
        mapping = [
            {"batch_page": batch_page, "source_page": source_page}
            for batch_page, source_page in enumerate(source_pages, 1)
        ]
        map_path = batch_dir / f"batch_{batch_number:04d}.map.json"
        write_json(map_path, mapping)
        batch_records.append(
            {
                "batch": batch_number,
                "pdf": str(pdf_path.relative_to(root)),
                "map": str(map_path.relative_to(root)),
                "page_count": len(source_pages),
                "source_pages": source_pages,
            }
        )

    manifest = {
        "source_pdf": str(source),
        "expected_page_count": len(reader.pages),
        "thresholds": {
            "direct_min_characters": 500,
            "direct_min_words": 75,
            "direct_min_alpha_token_fraction": 0.50,
            "direct_max_weird_token_fraction": 0.05,
            "azure_batch_size": args.azure_batch_size,
        },
        "counts": {
            "direct": sum(page["route"] == "direct" for page in pages),
            "azure": len(azure_source_pages),
        },
        "pages": pages,
        "azure_batches": batch_records,
    }
    write_json(root / "manifest.json", manifest)
    print(json.dumps(manifest["counts"], indent=2))
    return 0


def azure_request(
    url: str,
    key: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    max_attempts: int = 12,
) -> tuple[dict, dict]:
    headers = {"Ocp-Apim-Subscription-Key": key}
    if content_type:
        headers["Content-Type"] = content_type
    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = response.read()
                return (json.loads(body) if body else {}), dict(response.headers)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if not retryable or attempt == max_attempts:
                raise RuntimeError(
                    f"Azure request failed ({exc.code}): {detail}"
                ) from exc
            retry_after = exc.headers.get("Retry-After")
            match = re.search(r"retry after\s+(\d+)\s+seconds", detail, re.I)
            delay = float(retry_after) if retry_after and retry_after.isdigit() else (
                float(match.group(1)) if match else min(60.0, 5.0 * attempt)
            )
            delay += 1.0
            print(f"Azure HTTP {exc.code}; retrying in {delay:.0f}s...")
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == max_attempts:
                raise RuntimeError(
                    f"Azure network request failed after {max_attempts} attempts: {exc}"
                ) from exc
            delay = min(60.0, 5.0 * attempt)
            print(f"Azure network interruption; retrying in {delay:.0f}s...")
            time.sleep(delay)
    raise AssertionError("unreachable")


def analyze_azure(pdf: Path, endpoint: str, key: str, poll_seconds: float) -> dict:
    query = urllib.parse.urlencode(
        {
            "_overload": "analyzeDocument",
            "api-version": AZURE_API_VERSION,
            "outputContentFormat": "markdown",
        }
    )
    url = (
        f"{endpoint.rstrip('/')}/documentintelligence/documentModels/"
        f"{AZURE_MODEL}:analyze?{query}"
    )
    _, headers = azure_request(
        url,
        key,
        data=pdf.read_bytes(),
        content_type="application/pdf",
    )
    operation_url = headers.get("Operation-Location")
    if not operation_url:
        raise RuntimeError("Azure did not return Operation-Location.")
    while True:
        result, _ = azure_request(operation_url, key)
        if result.get("status") == "succeeded":
            return result
        if result.get("status") == "failed":
            raise RuntimeError(json.dumps(result, indent=2))
        time.sleep(poll_seconds)


def page_markdown(content: str, page: dict) -> str:
    chunks = []
    for span in page.get("spans", []):
        offset = int(span.get("offset", 0))
        length = int(span.get("length", 0))
        chunks.append(content[offset : offset + length])
    return normalized_text("\n".join(chunks))


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def azure_confidence(page: dict, text: str) -> tuple[dict, list[str]]:
    confidences = [
        float(word.get("confidence", 0.0))
        for word in page.get("words", [])
        if "confidence" in word
    ]
    mean = sum(confidences) / len(confidences) if confidences else 0.0
    low_fraction = (
        sum(confidence < 0.80 for confidence in confidences) / len(confidences)
        if confidences
        else 1.0
    )
    metrics = {
        "characters": len(text),
        "word_count": len(confidences),
        "mean_word_confidence": round(mean, 4),
        "p10_word_confidence": round(percentile(confidences, 0.10), 4),
        "fraction_words_below_0_80": round(low_fraction, 4),
        "selection_mark_count": len(page.get("selectionMarks", [])),
    }
    reasons = []
    if not confidences:
        reasons.append("no_confident_words")
    if len(text) < 50:
        reasons.append("fewer_than_50_characters")
    if mean < 0.93:
        reasons.append("mean_confidence_below_0_93")
    if metrics["p10_word_confidence"] < 0.75:
        reasons.append("p10_confidence_below_0_75")
    if low_fraction > 0.12:
        reasons.append("more_than_12_percent_low_confidence_words")
    return metrics, reasons


def run_azure(args: argparse.Namespace) -> int:
    root = args.pipeline.resolve()
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    endpoint = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    key = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_KEY")

    raw_dir = root / "stage2_azure" / "raw"
    pages_dir = root / "stage2_azure" / "pages"
    raw_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)
    page_lookup = {page["source_page"]: page for page in manifest["pages"]}

    for batch in manifest["azure_batches"]:
        batch_number = batch["batch"]
        pdf_path = root / batch["pdf"]
        map_path = root / batch["map"]
        checkpoint = raw_dir / f"batch_{batch_number:04d}.json"
        mapping = json.loads(map_path.read_text(encoding="utf-8"))
        if checkpoint.exists():
            result = json.loads(checkpoint.read_text(encoding="utf-8"))
            print(f"Reusing Azure batch {batch_number}")
        else:
            if not endpoint or not key:
                raise SystemExit(
                    "Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and "
                    "AZURE_DOCUMENT_INTELLIGENCE_KEY."
                )
            print(f"Submitting Azure batch {batch_number}: {len(mapping)} pages")
            result = analyze_azure(pdf_path, endpoint, key, args.poll_seconds)
            write_json(checkpoint, result)

        analysis = result.get("analyzeResult", {})
        returned = analysis.get("pages", [])
        if len(returned) != len(mapping):
            raise RuntimeError(
                f"Azure batch {batch_number} returned {len(returned)} of "
                f"{len(mapping)} pages. Check the pricing-tier page limit."
            )
        by_batch_page = {int(page["pageNumber"]): page for page in returned}
        for item in mapping:
            batch_page = item["batch_page"]
            source_page = item["source_page"]
            if batch_page not in by_batch_page:
                raise RuntimeError(
                    f"Azure batch {batch_number} omitted batch page {batch_page}."
                )
            azure_page = by_batch_page[batch_page]
            text = page_markdown(analysis.get("content", ""), azure_page)
            metrics, review_reasons = azure_confidence(azure_page, text)
            output = pages_dir / f"source_page_{source_page:04d}.md"
            output.write_text(
                f"<!-- source-page: {source_page}; method: azure -->\n\n{text}\n",
                encoding="utf-8",
            )
            record = page_lookup[source_page]
            record["azure_metrics"] = metrics
            record["route"] = "llm" if review_reasons else "azure"
            record["status"] = "pending" if review_reasons else "accepted"
            record["llm_review_reasons"] = review_reasons

        write_json(manifest_path, manifest)

    manifest["counts"] = {
        "direct": sum(page["route"] == "direct" for page in manifest["pages"]),
        "azure": sum(page["route"] == "azure" for page in manifest["pages"]),
        "llm": sum(page["route"] == "llm" for page in manifest["pages"]),
    }
    write_json(manifest_path, manifest)
    print(json.dumps(manifest["counts"], indent=2))
    return 0


def build_llm_queue(args: argparse.Namespace) -> int:
    root = args.pipeline.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    source = Path(manifest["source_pdf"])
    reader = PdfReader(str(source), strict=False)
    queue_root = root / "stage3_llm"
    single_dir = queue_root / "single_page_pdfs"
    image_dir = queue_root / "images"
    output_dir = queue_root / "pages"
    single_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    queue = []
    for page in manifest["pages"]:
        if page["route"] != "llm":
            continue
        source_page = page["source_page"]
        writer = PdfWriter()
        writer.add_page(reader.pages[source_page - 1])
        single_pdf = single_dir / f"source_page_{source_page:04d}.pdf"
        with single_pdf.open("wb") as handle:
            writer.write(handle)
        subprocess.run(
            [
                "qlmanage",
                "-t",
                "-s",
                str(args.image_size),
                "-o",
                str(image_dir),
                str(single_pdf),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        generated = image_dir / f"{single_pdf.name}.png"
        image = image_dir / f"source_page_{source_page:04d}.png"
        if generated != image:
            generated.replace(image)
        queue.append(
            {
                "source_page": source_page,
                "image": str(image.relative_to(root)),
                "azure_text": str(
                    (
                        root
                        / "stage2_azure"
                        / "pages"
                        / f"source_page_{source_page:04d}.md"
                    ).relative_to(root)
                ),
                "output": str(
                    (output_dir / f"source_page_{source_page:04d}.md").relative_to(root)
                ),
                "reasons": page.get("llm_review_reasons", []),
                "azure_metrics": page.get("azure_metrics", {}),
            }
        )

    prompt = """Transcribe and correct this legal-record page using the image.

The Azure OCR draft is supplied as a convenience, but the image is authoritative.

Rules:
- Preserve all wording, headings, paragraph order, capitalization, numbers, and punctuation.
- Include stamps, handwriting, checked/unchecked boxes, and the Bates number.
- Describe signatures as [SIGNATURE: printed name] rather than inventing handwriting.
- Do not summarize, complete boilerplate from memory, or silently repair legal language.
- Mark unreadable text as [UNCERTAIN: best reading].
- Return Markdown only.
"""
    (queue_root / "VISION_PROMPT.txt").write_text(prompt, encoding="utf-8")
    write_json(queue_root / "queue.json", queue)
    print(json.dumps({"llm_review_pages": len(queue)}, indent=2))
    return 0


def run_llm(args: argparse.Namespace) -> int:
    root = args.pipeline.resolve()
    queue_path = root / "stage3_llm" / "queue.json"
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    codex = shutil.which("codex")
    if not codex:
        raise SystemExit("The authenticated Codex CLI was not found.")
    logs_dir = root / "stage3_llm" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    pending = []
    for item in queue:
        output = root / item["output"]
        if output.exists() and output.stat().st_size > 0:
            continue
        pending.append(item)
    if args.limit:
        pending = pending[: args.limit]

    prompt_template = """You are performing the final visual transcription pass for source PDF page {source_page}.

Read the attached page image directly. The image is authoritative. The Azure OCR
draft below is only a starting point and may contain omissions or errors.

Return only corrected Markdown for this single page. Do not add commentary,
analysis, confidence summaries, or Markdown fences.

Rules:
- Transcribe the page verbatim and preserve all material wording.
- Preserve headings, paragraph order, capitalization, numbers, punctuation,
  tables, and list structure where visible.
- Include stamps, handwritten text, checked/unchecked boxes, and the Bates/page
  number.
- Describe signatures as [SIGNATURE: printed name] when the printed name is
  visible; never invent handwriting.
- Do not summarize, complete boilerplate from memory, or silently rewrite legal
  language.
- Mark genuinely unreadable text as [UNCERTAIN: best reading].
- Keep repeated boilerplate when it appears on the page.

Azure OCR draft:

{azure_text}
"""

    def process(item: dict) -> dict:
        source_page = item["source_page"]
        image = root / item["image"]
        azure_text = (root / item["azure_text"]).read_text(encoding="utf-8")
        output = root / item["output"]
        output.parent.mkdir(parents=True, exist_ok=True)
        log = logs_dir / f"source_page_{source_page:04d}.log"
        prompt = prompt_template.format(
            source_page=source_page,
            azure_text=azure_text,
        )
        command = [
            codex,
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "-C",
            str(root),
            "-m",
            args.model,
            "-i",
            str(image),
            "-o",
            str(output),
            "-",
        ]
        last_error = ""
        for attempt in range(1, args.max_attempts + 1):
            try:
                completed = subprocess.run(
                    command,
                    input=prompt,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=args.timeout_seconds,
                    check=False,
                )
                log.write_text(completed.stdout or "", encoding="utf-8")
                if (
                    completed.returncode == 0
                    and output.exists()
                    and output.stat().st_size > 0
                ):
                    return {"source_page": source_page, "status": "completed"}
                last_error = (
                    f"exit={completed.returncode}, "
                    f"output_bytes={output.stat().st_size if output.exists() else 0}"
                )
            except subprocess.TimeoutExpired:
                last_error = f"timeout_after_{args.timeout_seconds}s"
            if attempt < args.max_attempts:
                time.sleep(min(30, attempt * 5))
        return {
            "source_page": source_page,
            "status": "failed",
            "error": last_error,
        }

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process, item): item for item in pending}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print(json.dumps(result))

    completed_count = sum(result["status"] == "completed" for result in results)
    failed = [result for result in results if result["status"] == "failed"]
    summary = {
        "queued_this_run": len(pending),
        "completed_this_run": completed_count,
        "failed": failed,
        "total_output_pages": sum(
            (root / item["output"]).exists()
            and (root / item["output"]).stat().st_size > 0
            for item in queue
        ),
        "total_queue_pages": len(queue),
        "model": args.model,
    }
    write_json(root / "stage3_llm" / "run_summary.json", summary)
    print(json.dumps(summary, indent=2))
    if failed:
        raise RuntimeError(f"{len(failed)} vision jobs failed.")
    return 0


def run_llm_batched(args: argparse.Namespace) -> int:
    root = args.pipeline.resolve()
    queue = json.loads(
        (root / "stage3_llm" / "queue.json").read_text(encoding="utf-8")
    )
    codex = shutil.which("codex")
    if not codex:
        raise SystemExit("The authenticated Codex CLI was not found.")
    logs_dir = root / "stage3_llm" / "logs"
    responses_dir = root / "stage3_llm" / "batch_responses"
    logs_dir.mkdir(parents=True, exist_ok=True)
    responses_dir.mkdir(parents=True, exist_ok=True)
    schema_path = root / "stage3_llm" / "vision_output_schema.json"
    write_json(
        schema_path,
        {
            "type": "object",
            "properties": {
                "pages": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_page": {"type": "integer"},
                            "markdown": {"type": "string"},
                        },
                        "required": ["source_page", "markdown"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["pages"],
            "additionalProperties": False,
        },
    )

    pending = [
        item
        for item in queue
        if not (
            (root / item["output"]).exists()
            and (root / item["output"]).stat().st_size > 0
        )
    ]
    if args.limit:
        pending = pending[: args.limit]
    batches = [
        pending[index : index + args.batch_size]
        for index in range(0, len(pending), args.batch_size)
    ]

    def process(batch: list[dict]) -> dict:
        page_numbers = [item["source_page"] for item in batch]
        batch_name = f"pages_{page_numbers[0]:04d}_{page_numbers[-1]:04d}"
        response_path = responses_dir / f"{batch_name}.json"
        log_path = logs_dir / f"{batch_name}.log"
        packets = []
        for image_index, item in enumerate(batch, 1):
            azure_text = (root / item["azure_text"]).read_text(encoding="utf-8")
            packets.append(
                f"IMAGE {image_index} = SOURCE PAGE {item['source_page']}\n"
                f"AZURE OCR DRAFT:\n{azure_text}"
            )
        prompt = """Perform final visual transcription for each attached legal-record page.

Images are attached in the same order as the page packets below. The image is
authoritative; each Azure OCR draft is only a starting point.

For every page:
- Transcribe verbatim and preserve material wording, headings, paragraph order,
  capitalization, numbers, punctuation, tables, and lists.
- Include stamps, handwriting, checked/unchecked boxes, and Bates/page numbers.
- Describe signatures as [SIGNATURE: printed name] when the printed name is
  visible; never invent handwriting.
- Do not summarize, complete boilerplate from memory, or silently rewrite legal
  language.
- Mark genuinely unreadable text as [UNCERTAIN: best reading].
- Keep repeated boilerplate that appears in the image.

Return exactly one structured result for every requested source page.

PAGE PACKETS:

""" + "\n\n====================\n\n".join(packets)
        command = [
            codex,
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox",
            "read-only",
            "-C",
            str(root),
            "-m",
            args.model,
            "--output-schema",
            str(schema_path),
        ]
        command.extend(["-i", *[str(root / item["image"]) for item in batch]])
        command.extend(["-o", str(response_path), "-"])
        last_error = ""
        for attempt in range(1, args.max_attempts + 1):
            try:
                completed = subprocess.run(
                    command,
                    input=prompt,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=args.timeout_seconds,
                    check=False,
                )
                log_path.write_text(completed.stdout or "", encoding="utf-8")
                if completed.returncode != 0 or not response_path.exists():
                    last_error = f"exit={completed.returncode}"
                    raise ValueError(last_error)
                response = json.loads(response_path.read_text(encoding="utf-8"))
                returned = {
                    int(page["source_page"]): page["markdown"].strip()
                    for page in response.get("pages", [])
                }
                if set(returned) != set(page_numbers):
                    last_error = (
                        f"expected_pages={page_numbers}, "
                        f"returned_pages={sorted(returned)}"
                    )
                    raise ValueError(last_error)
                if any(not returned[number] for number in page_numbers):
                    last_error = "one_or_more_empty_transcripts"
                    raise ValueError(last_error)
                for item in batch:
                    output = root / item["output"]
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text(
                        returned[item["source_page"]] + "\n",
                        encoding="utf-8",
                    )
                return {"pages": page_numbers, "status": "completed"}
            except (
                json.JSONDecodeError,
                OSError,
                subprocess.TimeoutExpired,
                ValueError,
            ) as exc:
                last_error = str(exc)
                if attempt < args.max_attempts:
                    time.sleep(min(30, attempt * 5))
        return {"pages": page_numbers, "status": "failed", "error": last_error}

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process, batch) for batch in batches]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print(json.dumps(result))

    failed = [result for result in results if result["status"] == "failed"]
    summary = {
        "batches_this_run": len(batches),
        "pages_requested_this_run": len(pending),
        "failed": failed,
        "total_output_pages": sum(
            (root / item["output"]).exists()
            and (root / item["output"]).stat().st_size > 0
            for item in queue
        ),
        "total_queue_pages": len(queue),
        "model": args.model,
        "batch_size": args.batch_size,
    }
    write_json(root / "stage3_llm" / "run_summary.json", summary)
    print(json.dumps(summary, indent=2))
    if failed:
        raise RuntimeError(f"{len(failed)} batched vision jobs failed.")
    return 0


def finalize(args: argparse.Namespace) -> int:
    root = args.pipeline.resolve()
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output = []
    missing = []

    for page in manifest["pages"]:
        source_page = page["source_page"]
        route = page["route"]
        if route == "direct":
            path = root / "stage1_direct" / "pages" / f"source_page_{source_page:04d}.md"
        elif route == "azure":
            path = root / "stage2_azure" / "pages" / f"source_page_{source_page:04d}.md"
        else:
            path = root / "stage3_llm" / "pages" / f"source_page_{source_page:04d}.md"
        if not path.exists():
            missing.append({"source_page": source_page, "expected": str(path)})
            continue
        text = path.read_text(encoding="utf-8").strip()
        output.append(
            f"<!-- source-page: {source_page}; accepted-method: {route} -->\n\n{text}"
        )
        page["status"] = "accepted"

    report = {
        "expected_page_count": manifest["expected_page_count"],
        "assembled_page_count": len(output),
        "complete": not missing and len(output) == manifest["expected_page_count"],
        "missing": missing,
    }
    write_json(root / "final_coverage_report.json", report)
    if not report["complete"]:
        raise RuntimeError(json.dumps(report, indent=2))
    (root / "document.md").write_text(
        "\n\n---\n\n".join(output) + "\n",
        encoding="utf-8",
    )
    write_json(manifest_path, manifest)
    print(json.dumps(report, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    main = argparse.ArgumentParser()
    commands = main.add_subparsers(dest="command", required=True)

    prep = commands.add_parser("prepare")
    prep.add_argument("pdf", type=Path)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--azure-batch-size", type=int, default=200)
    prep.set_defaults(func=prepare)

    azure = commands.add_parser("run-azure")
    azure.add_argument("--pipeline", type=Path, required=True)
    azure.add_argument("--poll-seconds", type=float, default=3.0)
    azure.set_defaults(func=run_azure)

    queue = commands.add_parser("build-llm-queue")
    queue.add_argument("--pipeline", type=Path, required=True)
    queue.add_argument("--image-size", type=int, default=2400)
    queue.set_defaults(func=build_llm_queue)

    vision = commands.add_parser("run-llm")
    vision.add_argument("--pipeline", type=Path, required=True)
    vision.add_argument("--model", default="gpt-5.4")
    vision.add_argument("--workers", type=int, default=4)
    vision.add_argument("--max-attempts", type=int, default=3)
    vision.add_argument("--timeout-seconds", type=int, default=900)
    vision.add_argument("--limit", type=int)
    vision.set_defaults(func=run_llm)

    batched_vision = commands.add_parser("run-llm-batched")
    batched_vision.add_argument("--pipeline", type=Path, required=True)
    batched_vision.add_argument("--model", default="gpt-5.4")
    batched_vision.add_argument("--workers", type=int, default=3)
    batched_vision.add_argument("--batch-size", type=int, default=4)
    batched_vision.add_argument("--max-attempts", type=int, default=3)
    batched_vision.add_argument("--timeout-seconds", type=int, default=1200)
    batched_vision.add_argument("--limit", type=int)
    batched_vision.set_defaults(func=run_llm_batched)

    finish = commands.add_parser("finalize")
    finish.add_argument("--pipeline", type=Path, required=True)
    finish.set_defaults(func=finalize)
    return main


def main() -> int:
    args = parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
