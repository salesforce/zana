export interface PickerOption<T extends string = string> {
  value: T;
  label: string;
}

/** A model option can expose a distinct runtime route beside its friendly name. */
export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
}

/** Thread `AvailableModel` rows (and the CLI adapter placeholder) share this shape. */
export type CatalogModelPickerRow = {
  model: string;
  displayName: string;
  routeProviderId?: string;
};

/** Same mapping Thread and CLI Agent feed `ModelReasoningPicker`. */
export function availableModelsToPickerOptions(
  rows: ReadonlyArray<CatalogModelPickerRow>
): ModelPickerOption[] {
  return rows.map((row) => ({
    value: row.model,
    label: row.displayName,
    ...(row.routeProviderId ? { routeProviderId: row.routeProviderId } : {})
  }));
}
