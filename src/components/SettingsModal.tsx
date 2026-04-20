"use client";

type Props = {
  settings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  apiTokenInput: string;
  onApiTokenChange: (value: string) => void;
  busy: boolean;
  selectedSourceSyncable: boolean;
  onSave: () => void;
  onSync: () => void;
  onClose: () => void;
};

export function SettingsModal({
  settings,
  setSettings,
  apiTokenInput,
  onApiTokenChange,
  busy,
  selectedSourceSyncable,
  onSave,
  onSync,
  onClose
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Connector Settings</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}>Close</button>
        </div>

        <div className="settings-grid">
          <label>
            OpenRouter API Key
            <input
              type="password"
              value={settings.openrouter_api_key || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, openrouter_api_key: e.target.value }))}
              placeholder="sk-or-..."
            />
          </label>
          <label>
            OpenRouter Model
            <input
              value={settings.openrouter_model || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, openrouter_model: e.target.value }))}
            />
          </label>
          <label>
            Google Spreadsheet ID
            <input
              value={settings.google_sheets_spreadsheet_id || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, google_sheets_spreadsheet_id: e.target.value }))}
            />
          </label>
          <label>
            Google Sheets Range
            <input
              value={settings.google_sheets_range || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, google_sheets_range: e.target.value }))}
            />
          </label>
          <label>
            Google Sheets API Key
            <input
              type="password"
              value={settings.google_sheets_api_key || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, google_sheets_api_key: e.target.value }))}
            />
          </label>
          <label>
            Google Sheets Published CSV URL
            <input
              value={settings.google_sheets_bank_csv_url || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, google_sheets_bank_csv_url: e.target.value }))}
            />
          </label>
        </div>

        <div className="settings-advanced">
          <h4>Advanced API Access</h4>
          <p className="muted">Optional token used only for protected API routes in production mode.</p>
          <input
            type="password"
            value={apiTokenInput}
            onChange={(e) => onApiTokenChange(e.target.value)}
            placeholder="Bearer token (optional)"
          />
        </div>

        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onSave}>Save Settings</button>
          <button className="btn btn-primary" disabled={busy || !selectedSourceSyncable} onClick={onSync}>
            Sync Active Source
          </button>
        </div>
      </div>
    </div>
  );
}
