"""흑백→컬러: DeOldify(GAN), stub 폴백.

vendor/DeOldify(thookham 포크) + HF 가중치(ColorizeStable_gen 등).
기본 HF 레포는 spensercai/DeOldify(.pth LFS). DEOLDIFY_HF_REPO 로 변경 가능.
프롬프트는 API 호환용(DeOldify는 텍스트 조건 없음).
"""

from __future__ import annotations

import io
import logging
import os
import sys
import threading
import warnings
from pathlib import Path
from typing import Any, BinaryIO, Literal

logger = logging.getLogger(__name__)

from PIL import Image, ImageEnhance, ImageOps

_lock = threading.Lock()
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_VENDOR_DEOLDIFY = _BACKEND_DIR / "vendor" / "DeOldify"
_DEFAULT_PROMPT = "color photograph, natural colors"

_deoldify_filter_cache: dict[str, Any] = {}
_deoldify_fallback_warned = False


def default_prompt() -> str:
    return os.environ.get("COLORIZE_DEFAULT_PROMPT", _DEFAULT_PROMPT)


def default_negative_prompt() -> str:
    return os.environ.get("COLORIZE_NEGATIVE_PROMPT", "")


def _mean_abs_diff_rgb(a: Image.Image, b: Image.Image) -> float:
    import numpy as np

    aa = np.asarray(a.convert("RGB"), dtype=np.float32)
    bb = np.asarray(b.convert("RGB"), dtype=np.float32)
    if aa.shape != bb.shape:
        raise ValueError("mean abs diff: size mismatch")
    return float(np.abs(aa - bb).mean())


def _metrics_for_pair(model_in: Image.Image, out: Image.Image) -> dict[str, Any]:
    return {
        "meanAbsDiff": round(_mean_abs_diff_rgb(model_in, out), 3),
    }


def _avg_channel_spread(rgb: Image.Image, step: int = 6) -> float:
    w, h = rgb.size
    px = rgb.load()
    n = 0
    spread = 0.0
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            n += 1
            spread += max(abs(r - g), abs(g - b), abs(r - b))
    return spread / n if n else 0.0


def _stub_colorize(raw: bytes, _prompt: str) -> bytes:
    """GPU 없이 데모용."""
    im = Image.open(io.BytesIO(raw))
    rgb = im.convert("RGB")
    if _avg_channel_spread(rgb) < 6.0:
        gray = rgb.convert("L")
        out = ImageOps.colorize(gray, "#1f140e", "#f0e6d8")
        out = ImageEnhance.Color(out).enhance(1.2)
        out = ImageEnhance.Brightness(out).enhance(1.03)
    else:
        out = ImageEnhance.Color(rgb).enhance(1.35)
        out = ImageEnhance.Brightness(out).enhance(1.02)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def _stub_colorize_with_metrics(raw: bytes, prompt: str) -> tuple[bytes, dict[str, Any]]:
    out_b = _stub_colorize(raw, prompt)
    inp = Image.open(io.BytesIO(raw)).convert("RGB")
    oim = Image.open(io.BytesIO(out_b)).convert("RGB")
    if inp.size != oim.size:
        inp = inp.resize(oim.size, Image.Resampling.LANCZOS)
    m = _metrics_for_pair(inp, oim)
    m["stub"] = True
    return out_b, m


def _ensure_deoldify_vendor_path() -> None:
    v = _VENDOR_DEOLDIFY.resolve()
    if not v.is_dir():
        raise RuntimeError(
            f"DeOldify 소스 없음: {v}. "
            "git clone https://github.com/thookham/DeOldify.git backend/vendor/DeOldify"
        )
    p = str(v)
    if p not in sys.path:
        sys.path.insert(0, p)


def _deoldify_weights_path() -> tuple[Path, str]:
    """(learn.path 루트, load 시 사용할 weights 베이스 이름)."""
    root = Path(os.environ.get("DEOLDIFY_ROOT", str(_BACKEND_DIR / "models" / "deoldify")))
    root.mkdir(parents=True, exist_ok=True)
    models_dir = root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    variant = os.environ.get("DEOLDIFY_VARIANT", "stable").lower()
    if variant == "artistic":
        fname = "ColorizeArtistic_gen.pth"
        wname = "ColorizeArtistic_gen"
    else:
        fname = "ColorizeStable_gen.pth"
        wname = "ColorizeStable_gen"
    return root, wname


def _deoldify_hf_repo() -> str:
    r = (os.environ.get("DEOLDIFY_HF_REPO") or "spensercai/DeOldify").strip()
    return r or "spensercai/DeOldify"


# HF 실패·비정상 파일 시 jantic 공식 미러( Dropbox / deepai ).
_DEOLDIFY_PTH_FALLBACK_URLS: dict[str, str] = {
    "ColorizeStable_gen.pth": (
        "https://www.dropbox.com/s/axsd2g85uyixaho/ColorizeStable_gen.pth?dl=1"
    ),
    "ColorizeArtistic_gen.pth": "https://data.deepai.org/deoldify/ColorizeArtistic_gen.pth",
    "ColorizeVideo_gen.pth": "https://data.deepai.org/deoldify/ColorizeVideo_gen.pth",
}


def _deoldify_weight_file_ok(dest: Path, fname: str) -> bool:
    if not dest.is_file():
        return False
    n = dest.stat().st_size
    # gen 가중치는 수백 MB; 1MB 미만이면 HTML 에러 페이지 등
    if fname == "ColorizeArtistic_gen.pth":
        return n > 200_000_000
    if fname in ("ColorizeStable_gen.pth", "ColorizeVideo_gen.pth"):
        return n > 500_000_000
    return n > 1_000_000


def _stream_download(url: str, dest: Path) -> None:
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": "photobook-deoldify/1.0"}
    # 대용량 .pth: 연결·청크 간 대기 시간 여유
    with requests.get(
        url,
        stream=True,
        timeout=(60, 600),
        headers=headers,
    ) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
    tmp.replace(dest)


def _download_deoldify_weights(models_dir: Path, fname: str) -> None:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as e:
        raise RuntimeError(
            "huggingface-hub 필요: pip install huggingface-hub"
        ) from e

    dest = models_dir / fname
    if _deoldify_weight_file_ok(dest, fname):
        return

    if dest.exists():
        try:
            dest.unlink()
        except OSError:
            pass

    repo_id = _deoldify_hf_repo()
    logger.info(
        "DeOldify 가중치 다운로드 중: %s (HF %s, 최초 1회·용량 큼)",
        fname,
        repo_id,
    )

    def mirror_or_raise(reason: str, cause: BaseException | None = None) -> None:
        fb = _DEOLDIFY_PTH_FALLBACK_URLS.get(fname)
        if not fb:
            msg = (
                f"DeOldify 가중치를 받을 수 없습니다 ({reason}). "
                f"{fname}에 대한 공식 미러가 없습니다."
            )
            if cause:
                raise RuntimeError(msg) from cause
            raise RuntimeError(msg)
        logger.info("공식 미러에서 다운로드: %s (%s)", fname, reason)
        _stream_download(fb, dest)

    try:
        hf_hub_download(
            repo_id=repo_id,
            filename=fname,
            local_dir=str(models_dir),
        )
    except Exception as e:
        logger.warning(
            "Hugging Face에서 %s 실패 (%s), 미러로 재시도합니다.",
            fname,
            type(e).__name__,
        )
        mirror_or_raise("HF 오류", e)

    if not _deoldify_weight_file_ok(dest, fname):
        logger.warning(
            "로컬 가중치가 비정상(크기 부족 등)입니다. 삭제 후 미러에서 다시 받습니다: %s",
            dest,
        )
        try:
            dest.unlink()
        except OSError:
            pass
        mirror_or_raise("유효성 검사 실패")

    if not _deoldify_weight_file_ok(dest, fname):
        raise RuntimeError(
            f"DeOldify 가중치가 비정상입니다(파일을 지운 뒤 재시도): {dest}"
        )


def _ensure_deoldify_filter():
    _ensure_deoldify_vendor_path()
    import torch
    from deoldify.filters import ColorizerFilter, MasterFilter
    from deoldify.generators import gen_inference_deep, gen_inference_wide

    root, wname = _deoldify_weights_path()
    models_dir = root / "models"
    variant = os.environ.get("DEOLDIFY_VARIANT", "stable").lower()
    fname = f"{wname}.pth"
    _download_deoldify_weights(models_dir, fname)

    cache_key = f"{variant}|{root}|{wname}|{torch.cuda.is_available()}"
    if _deoldify_filter_cache.get("key") == cache_key and _deoldify_filter_cache.get("filtr"):
        return _deoldify_filter_cache["filtr"]

    render_factor = int(os.environ.get("DEOLDIFY_RENDER_FACTOR", "35"))
    render_factor = max(7, min(45, render_factor))

    if variant == "artistic":
        learn = gen_inference_deep(root_folder=root, weights_name=wname)
    else:
        learn = gen_inference_wide(root_folder=root, weights_name=wname)

    filtr = MasterFilter([ColorizerFilter(learn=learn)], render_factor=render_factor)
    _deoldify_filter_cache.clear()
    _deoldify_filter_cache["key"] = cache_key
    _deoldify_filter_cache["filtr"] = filtr
    _deoldify_filter_cache["render_factor"] = render_factor
    return filtr


def _deoldify_colorize(raw: bytes, prompt: str) -> tuple[bytes, dict[str, Any]]:
    filtr = _ensure_deoldify_filter()
    render_factor = int(
        _deoldify_filter_cache.get("render_factor")
        or int(os.environ.get("DEOLDIFY_RENDER_FACTOR", "35"))
    )
    orig = Image.open(io.BytesIO(raw)).convert("RGB")
    if prompt:
        logger.debug("DeOldify는 텍스트 조건 미사용; prompt=%r", prompt[:80])

    post = os.environ.get("DEOLDIFY_POST_PROCESS", "1").lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
    out = filtr.filter(
        orig,
        orig,
        render_factor=render_factor,
        post_process=post,
    )
    metrics = _metrics_for_pair(orig, out)
    metrics["deoldifyVariant"] = os.environ.get("DEOLDIFY_VARIANT", "stable")
    metrics["renderFactor"] = render_factor
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue(), metrics


def colorize_image(
    file_obj: BinaryIO,
    prompt: str | None = None,
) -> tuple[bytes, str, Literal["deoldify", "stub"], dict[str, Any]]:
    """
    COLORIZE_MODE=deoldify(기본) 실패 시 stub 폴백.
    """
    global _deoldify_fallback_warned
    raw = file_obj.read()
    if not raw:
        raise ValueError("empty image")
    eff = (prompt or "").strip() or default_prompt()
    mode = os.environ.get("COLORIZE_MODE", "deoldify").lower()
    fallback_stub = os.environ.get("COLORIZE_FALLBACK_STUB", "1").lower() not in (
        "0",
        "false",
        "no",
    )

    with _lock:
        if mode in ("deoldify", "sd", "oldify"):
            if mode == "sd":
                logger.warning(
                    "COLORIZE_MODE=sd 는 제거됨. DeOldify 사용(COLORIZE_MODE=deoldify)."
                )
            try:
                out_b, metrics = _deoldify_colorize(raw, eff)
                return out_b, eff, "deoldify", metrics
            except Exception as e:
                if not fallback_stub:
                    raise
                if not _deoldify_fallback_warned:
                    msg = (
                        f"COLORIZE_MODE=deoldify 실패 ({type(e).__name__}: {e}); "
                        "stub으로 대체. pip install -r requirements-deoldify.txt, "
                        "vendor/DeOldify 클론, CUDA/VRAM 확인. "
                        "COLORIZE_FALLBACK_STUB=0 이면 예외 그대로."
                    )
                    logger.warning(msg)
                    warnings.warn(msg, UserWarning, stacklevel=2)
                    _deoldify_fallback_warned = True
                else:
                    logger.debug("deoldify 실패 후 stub: %s", e)
                out_b, metrics = _stub_colorize_with_metrics(raw, eff)
                return out_b, eff, "stub", metrics
        out_b, metrics = _stub_colorize_with_metrics(raw, eff)
        return out_b, eff, "stub", metrics
