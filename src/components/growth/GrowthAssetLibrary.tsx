import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildGrowthAssetFileUrl,
  fetchGrowthAssetImportCandidates,
  fetchGrowthAssets,
  importGrowthAsset,
  uploadGrowthAsset,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_ASSET_MIME_TYPES,
  type GrowthAssetImportCandidate,
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

interface ImportCandidateFields {
  title: string;
  alt: string;
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
  const [importCandidates, setImportCandidates] = useState<GrowthAssetImportCandidate[]>([]);
  const [importFields, setImportFields] = useState<Record<string, ImportCandidateFields>>({});
  const [importedAssets, setImportedAssets] = useState<Record<string, GrowthAssetMetadata>>({});
  const [importMessages, setImportMessages] = useState<Record<string, string>>({});
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importBusy, setImportBusy] = useState<Record<string, boolean>>({});
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const candidateControllerRef = useRef<AbortController | null>(null);
  const importControllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    candidateControllerRef.current?.abort();
    candidateControllerRef.current = null;
    importControllersRef.current.forEach((controller) => controller.abort());
    importControllersRef.current.clear();
    setAssets([]);
    setFile(null);
    setTitle("");
    setAlt("");
    setLoadError("");
    setUploadError("");
    setValidationError("");
    setUploaded(false);
    setUploading(false);
    setImportCandidates([]);
    setImportFields({});
    setImportedAssets({});
    setImportMessages({});
    setImportErrors({});
    setImportBusy({});
    setCandidateError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      setCandidateLoading(false);
      return;
    }

    const controller = new AbortController();
    const candidateController = new AbortController();
    candidateControllerRef.current = candidateController;
    setLoading(true);
    setCandidateLoading(true);
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
    void fetchGrowthAssetImportCandidates(repository, candidateController.signal)
      .then((result) => {
        if (candidateController.signal.aborted) return;
        setImportCandidates(result);
        setImportFields(Object.fromEntries(result.map((candidate) => [
          candidate.url,
          { title: candidate.title, alt: candidate.alt },
        ])));
      })
      .catch((cause: unknown) => {
        if (!candidateController.signal.aborted && (cause as Error).name !== "AbortError") {
          setCandidateError(t("growth.assetsImportLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!candidateController.signal.aborted) setCandidateLoading(false);
      });

    return () => {
      controller.abort();
      candidateController.abort();
      uploadControllerRef.current?.abort();
      importControllersRef.current.forEach((activeController) => activeController.abort());
    };
  }, [accountId, enabled, repository, t]);

  async function refreshImportCandidates() {
    candidateControllerRef.current?.abort();
    const controller = new AbortController();
    candidateControllerRef.current = controller;
    setCandidateLoading(true);
    setCandidateError("");
    try {
      const result = await fetchGrowthAssetImportCandidates(repository, controller.signal);
      if (controller.signal.aborted) return;
      setImportCandidates(result);
      setImportFields(Object.fromEntries(result.map((candidate) => [
        candidate.url,
        importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt },
      ])));
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setCandidateError(t("growth.assetsImportLoadError", { message: (cause as Error).message }));
      }
    } finally {
      if (candidateControllerRef.current === controller) {
        candidateControllerRef.current = null;
        setCandidateLoading(false);
      }
    }
  }

  async function saveImportCandidate(candidate: GrowthAssetImportCandidate) {
    const fields = importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt };
    if (!fields.title.trim() || !fields.alt.trim()) {
      setImportErrors((current) => ({ ...current, [candidate.url]: t("growth.assetsImportMetadataRequired") }));
      return;
    }
    importControllersRef.current.get(candidate.url)?.abort();
    const controller = new AbortController();
    importControllersRef.current.set(candidate.url, controller);
    setImportBusy((current) => ({ ...current, [candidate.url]: true }));
    setImportErrors((current) => ({ ...current, [candidate.url]: "" }));
    setImportMessages((current) => ({ ...current, [candidate.url]: "" }));
    try {
      const result = await importGrowthAsset({
        repository,
        origin: candidate.origin,
        url: candidate.url,
        title: fields.title.trim(),
        alt: fields.alt.trim(),
      }, controller.signal);
      if (controller.signal.aborted) return;
      setAssets((current) => [result.asset, ...current.filter((asset) => asset.id !== result.asset.id)]);
      setImportedAssets((current) => ({ ...current, [candidate.url]: result.asset }));
      setImportMessages((current) => ({
        ...current,
        [candidate.url]: t(result.duplicate ? "growth.assetsImportDuplicate" : "growth.assetsImported"),
      }));
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setImportErrors((current) => ({
          ...current,
          [candidate.url]: t("growth.assetsImportError", { message: (cause as Error).message }),
        }));
      }
    } finally {
      if (importControllersRef.current.get(candidate.url) === controller) {
        importControllersRef.current.delete(candidate.url);
        setImportBusy((current) => ({ ...current, [candidate.url]: false }));
      }
    }
  }

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

      <section className="growth-asset-import" aria-labelledby="growth-assets-import-title">
        <div className="growth-asset-import-heading">
          <div>
            <h3 id="growth-assets-import-title">{t("growth.assetsImportTitle")}</h3>
            <p>{t("growth.assetsImportDescription")}</p>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={candidateLoading}
            onClick={() => void refreshImportCandidates()}
          >
            {candidateLoading ? t("growth.assetsImportDiscovering") : t("growth.assetsImportRefresh")}
          </button>
        </div>
        {candidateLoading ? <p className="growth-asset-state" role="status">{t("growth.assetsImportLoading")}</p> : null}
        {candidateError ? <p className="growth-asset-error" role="alert">{candidateError}</p> : null}
        {!candidateLoading && !candidateError && importCandidates.length === 0 ? (
          <div className="growth-asset-state growth-asset-empty">
            <h3>{t("growth.assetsImportEmptyTitle")}</h3>
            <p>{t("growth.assetsImportEmptyDescription")}</p>
          </div>
        ) : null}
        {importCandidates.length ? (
          <div className="growth-asset-import-list">
            {importCandidates.map((candidate, index) => {
              const fields = importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt };
              const importedAsset = importedAssets[candidate.url];
              const titleId = `growth-asset-import-title-${index}`;
              const altId = `growth-asset-import-alt-${index}`;
              return (
                <article
                  className={`growth-asset-import-card${importedAsset ? " is-imported" : ""}`}
                  key={candidate.url}
                  aria-busy={Boolean(importBusy[candidate.url])}
                >
                  {importedAsset ? (
                    <div className="growth-asset-import-preview">
                      {importedAsset.kind === "image" ? (
                        <img src={buildGrowthAssetFileUrl(importedAsset.id)} alt={importedAsset.alt} loading="lazy" />
                      ) : (
                        <video
                          src={buildGrowthAssetFileUrl(importedAsset.id)}
                          aria-label={t("growth.assetsVideoPreview", { title: importedAsset.title })}
                          controls
                          preload="metadata"
                        />
                      )}
                    </div>
                  ) : null}
                  <div className="growth-asset-import-card-body">
                    <div className="growth-asset-badges">
                      <span>{t(originKeys[candidate.origin])}</span>
                      <span>{t("growth.assetsImportSource")}: {candidate.source}</span>
                    </div>
                    <code title={candidate.url}>{candidate.url}</code>
                    <label htmlFor={titleId}>
                      {t("growth.assetsTitleLabel")}
                      <input
                        id={titleId}
                        required
                        maxLength={500}
                        value={fields.title}
                        onChange={(event) => setImportFields((current) => ({
                          ...current,
                          [candidate.url]: { ...fields, title: event.target.value },
                        }))}
                      />
                    </label>
                    <label htmlFor={altId}>
                      {t("growth.assetsAltLabel")}
                      <textarea
                        id={altId}
                        required
                        maxLength={2000}
                        rows={2}
                        value={fields.alt}
                        onChange={(event) => setImportFields((current) => ({
                          ...current,
                          [candidate.url]: { ...fields, alt: event.target.value },
                        }))}
                      />
                    </label>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={Boolean(importBusy[candidate.url])}
                      onClick={() => void saveImportCandidate(candidate)}
                    >
                      {importBusy[candidate.url] ? t("growth.assetsImporting") : t("growth.assetsImport")}
                    </button>
                    {importErrors[candidate.url] ? <p className="growth-asset-error" role="alert">{importErrors[candidate.url]}</p> : null}
                    {importMessages[candidate.url] ? <p className="growth-asset-success" role="status">{importMessages[candidate.url]}</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

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
