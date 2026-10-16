import type { FormEvent } from "react";
import type { SearchDraft } from "../validation";
import { PAGE_SIZE_OPTIONS } from "../validation";

interface SearchFormProps {
  draft: SearchDraft;
  /** Field-keyed validation errors to show inline. */
  errors: Record<string, string>;
  cities: string[];
  citiesLoading: boolean;
  onDraftChange: (field: keyof SearchDraft, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  disabled: boolean;
}

const moneyFields: Array<{
  field: Extract<keyof SearchDraft, "minPrice" | "maxPrice" | "targetBudget">;
  label: string;
  placeholder: string;
}> = [
  { field: "minPrice", label: "Min price", placeholder: "e.g. 300000" },
  { field: "maxPrice", label: "Max price", placeholder: "e.g. 600000" },
  { field: "targetBudget", label: "Target budget", placeholder: "e.g. 500000" },
];

const SearchForm = ({
  draft,
  errors,
  cities,
  citiesLoading,
  onDraftChange,
  onSubmit,
  onReset,
  disabled,
}: SearchFormProps) => {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const renderError = (field: keyof SearchDraft) =>
    errors[field] ? (
      <p className="field-error" id={`search-${field}-error`} role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className="search-form" onSubmit={handleSubmit} noValidate>
      <div className="search-grid">
        {moneyFields.map(({ field, label, placeholder }) => (
          <div
            className={`field${errors[field] ? " field--invalid" : ""}`}
            key={field}
          >
            <label htmlFor={`search-${field}`}>{label}</label>
            <input
              id={`search-${field}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={placeholder}
              value={draft[field]}
              aria-invalid={Boolean(errors[field])}
              aria-describedby={
                errors[field] ? `search-${field}-error` : undefined
              }
              onChange={(e) => onDraftChange(field, e.target.value)}
            />
            {renderError(field)}
          </div>
        ))}

        <div className={`field${errors.minBedrooms ? " field--invalid" : ""}`}>
          <label htmlFor="search-minBedrooms">Min bedrooms</label>
          <input
            id="search-minBedrooms"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Any"
            value={draft.minBedrooms}
            aria-invalid={Boolean(errors.minBedrooms)}
            aria-describedby={
              errors.minBedrooms ? "search-minBedrooms-error" : undefined
            }
            onChange={(e) => onDraftChange("minBedrooms", e.target.value)}
          />
          {renderError("minBedrooms")}
        </div>

        <div className="field">
          <label htmlFor="search-city">City</label>
          <select
            id="search-city"
            value={draft.city}
            onChange={(e) => onDraftChange("city", e.target.value)}
          >
            <option value="">Any city</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
            {/* Keep a manually typed value visible even if not in the list. */}
            {draft.city && !cities.includes(draft.city) && (
              <option value={draft.city}>{draft.city}</option>
            )}
          </select>
          {citiesLoading && <p className="field-hint">Loading cities…</p>}
        </div>

        <div
          className={`field field--wide${errors.keyword ? " field--invalid" : ""}`}
        >
          <label htmlFor="search-keyword">Keyword in description</label>
          <input
            id="search-keyword"
            type="search"
            autoComplete="off"
            placeholder="e.g. pool, renovated, Metro…"
            value={draft.keyword}
            aria-invalid={Boolean(errors.keyword)}
            aria-describedby={
              errors.keyword ? "search-keyword-error" : undefined
            }
            onChange={(e) => onDraftChange("keyword", e.target.value)}
          />
          {renderError("keyword")}
        </div>

        <div className={`field${errors.pageSize ? " field--invalid" : ""}`}>
          <label htmlFor="search-pageSize">Results per page</label>
          <select
            id="search-pageSize"
            value={draft.pageSize}
            onChange={(e) => onDraftChange("pageSize", e.target.value)}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>
                {size} per page
              </option>
            ))}
          </select>
          {renderError("pageSize")}
        </div>
      </div>

      <div className="search-actions">
        <button
          type="submit"
          className="button button--primary"
          disabled={disabled}
        >
          Search listings
        </button>
        <button type="button" className="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </form>
  );
};

export default SearchForm;
