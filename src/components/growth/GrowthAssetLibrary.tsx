import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildGrowthAssetFileUrl,
  fetchGrowthAssets,
  uploadGrowthAsset,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_ASSET_MIME_TYPES,
  type GrowthAssetKind,
  type GrowthAssetMetadata,
  type GrowthAssetOrigin,
} from "../../types/growth";
import {
  validateGrowthAssetUpload,
  type GrowthAssetUploadValidationIssue,
} from "../../utils/growth/assets";

interface GrowthAssetLibraryProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

interface ImageDimensions {
  width?: number;
  height?: number;
}

const validationKeys: Record<GrowthAssetUploadValidationIssue, TranslationKey> = {
  "missing-file": "growth.assetsValidationMissingFile",
  "missing-title": "growth.assetsValidationMissingTitle",
  "missing-alt": "growth.assetsValidationMissingAlt",
  "unsupported-type": "growth.assetsValidationUnsupportedType",
  "empty-file": "growth.assetsValidationEmptyFile",
  "file-too-large": "growth.assetsValidationTooLarge",
};
const kindKeys: Record<GrowthAssetKind, TranslationKey> = {
  image: "growth.assetsKindImage",
  video: "growth.assetsKindVideo",
};
const originKeys: Record<GrowthAssetOrigin, TranslationKey> = {
  upload: "growth.assetsOriginUpload",
  readme: "growth.assetsOriginReadme",
  website: "growth.assetsOriginWebsite",
  generated: "growth.assetsOriginGenerated",
};

async function readImageDimensions(file: File, signal: AbortSignal): Promise<ImageDimensions> {
  if (!file.type.startsWith("image/") || typeof Image === "undefined" || !URL.createObjectURL) return {};

  return new Promise((resolve) => {
    const image = new Image();
    let objectUrl = "";
    let settled = false;
    const finish = (dimensions: ImageDimensions) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (objectUrl && URL.revokeObjectURL) URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };
    const abort = () => finish({});
    image.onload = () => finish({
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    });
    image.onerror = () => finish({});
    signal.addEventListener("abort", abort, { once: true });
    try {
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
    } catch {
      finish({});
    }
  });
}

export function GrowthAssetLibrary({ accountId, enabled, repository }: GrowthAssetLibraryProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<GrowthAssetMetadata[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setAssets([]);
    setFile(null);
    setTitle("");
    setAlt("");
    setLoadError("");
    setUploadError("");
    setValidationError("");
    setUploaded(false);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthAssets(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError(t("growth.assetsLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      uploadControllerRef.current?.abort();
    };
  }, [accountId, enabled, repository, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");
    setUploadError("");
    setLoadError("");
    setUploaded(false);
    const issue = validateGrowthAssetUpload({ file, title, alt });
    if (issue) {
      setValidationError(t(validationKeys[issue]));
      return;
    }

    const selectedFile = file as File;
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;
    setUploading(true);
    try {
      const dimensions = await readImageDimensions(selectedFile, controller.signal);
      if (controller.signal.aborted) return;
      const saved = await uploadGrowthAsset({
        repository,
        file: selectedFile,
        filename: selectedFile.name,
        title: title.trim(),
        alt: alt.trim(),
        ...dimensions,
      }, controller.signal);
      if (controller.signal.aborted) return;

      setAssets((current) => [saved, ...current.filter((asset) => asset.id !== saved.id)]);
      setFile(null);
      setTitle("");
      setAlt("");
      setUploaded(true);
      if (fileInputRef.current) fileInputRef.current.value = "";

      try {
        const refreshed = await fetchGrowthAssets(repository, controller.signal);
        if (!controller.signal.aborted) setAssets(refreshed);
      } catch (cause) {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError(t("growth.assetsRefreshError", { message: (cause as Error).message }));
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setUploadError(t("growth.assetsUploadError", { message: (cause as Error).message }));
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        setUploading(false);
      }
    }
  }

  return (
    <section className="growth-library-card growth-asset-library" aria-labelledby="growth-assets-title">
      <div className="growth-library-section-heading growth-asset-library-heading">
        <div>
          <span>{t("growth.assetsEyebrow")}</span>
          <h2 id="growth-assets-title">{t("growth.assetsTitle")}</h2>
          <p>{t("growth.assetsDescription")}</p>
        </div>
      </div>

      <form className="growth-asset-upload" aria-busy={uploading} onSubmit={(event) => void submit(event)}>
        <div className="growth-asset-upload-heading">
          <h3>{t("growth.assetsUploadTitle")}</h3>
          <p>{t("growth.assetsUploadHint")}</p>
        </div>
        <label htmlFor="growth-asset-file">
          {t("growth.assetsFile")}
          <input
            ref={fileInputRef}
            id="growth-asset-file"
            type="file"
            required
            accept={GROWTH_ASSET_MIME_TYPES.join(",")}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setValidationError("");
              setUploadError("");
              setUploaded(false);
            }}
          />
        </label>
        <label htmlFor="growth-asset-title">
          {t("growth.assetsTitleLabel")}
          <input
            id="growth-asset-title"
            value={title}
            required
            maxLength={500}
            onChange={(event) => {
              setTitle(event.target.value);
              setValidationError("");
              setUploaded(false);
            }}
          />
        </label>
        <label className="growth-asset-alt-field" htmlFor="growth-asset-alt">
          {t("growth.assetsAltLabel")}
          <textarea
            id="growth-asset-alt"
            value={alt}
            required
            maxLength={2000}
            rows={2}
            onChange={(event) => {
              setAlt(event.target.value);
              setValidationError("");
              setUploaded(false);
            }}
          />
          <small>{t("growth.assetsAltHint")}</small>
        </label>
        <button className="btn primary" type="submit" disabled={uploading}>
          {uploading ? t("growth.assetsUploading") : t("growth.assetsUpload")}
        </button>
      </form>

      {validationError ? <p className="growth-asset-error" role="alert">{validationError}</p> : null}
      {uploadError ? <p className="growth-asset-error" role="alert">{uploadError}</p> : null}
      {loadError ? <p className="growth-asset-error" role="alert">{loadError}</p> : null}
      {uploading ? <p className="growth-asset-progress" role="status">{t("growth.assetsUploadProgress")}</p> : null}
      {uploaded ? <p className="growth-asset-success" role="status">{t("growth.assetsUploaded")}</p> : null}
      {loading ? <p className="growth-asset-state" role="status">{t("growth.assetsLoading")}</p> : null}
      {!loading && !loadError && assets.length === 0 ? (
        <div className="growth-asset-state growth-asset-empty">
          <h3>{t("growth.assetsEmptyTitle")}</h3>
          <p>{t("growth.assetsEmptyDescription")}</p>
        </div>
      ) : null}

      {assets.length ? (
        <div className="growth-asset-grid" aria-label={t("growth.assetsGridLabel")}>
          {assets.map((asset) => {
            const previewUrl = buildGrowthAssetFileUrl(asset.id);
            return (
              <article className="growth-asset-card" key={asset.id}>
                <div className="growth-asset-preview">
                  {asset.kind === "image" ? (
                    <img src={previewUrl} alt={asset.alt} loading="lazy" />
                  ) : (
                    <video
                      src={previewUrl}
                      aria-label={t("growth.assetsVideoPreview", { title: asset.title })}
                      controls
                      preload="metadata"
                    />
                  )}
                </div>
                <div className="growth-asset-card-body">
                  <div className="growth-asset-badges">
                    <span>{t(kindKeys[asset.kind])}</span>
                    <span>{t(originKeys[asset.origin])}</span>
                  </div>
                  <h3>{asset.title}</h3>
                  <dl>
                    <div>
                      <dt>{t("growth.assetsDimensions")}</dt>
                      <dd>{asset.width && asset.height
                        ? t("growth.assetsDimensionsValue", { width: asset.width, height: asset.height })
                        : t("growth.assetsDimensionsUnknown")}</dd>
                    </div>
                    <div>
                      <dt>{t("growth.assetsAltText")}</dt>
                      <dd>{asset.alt}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
