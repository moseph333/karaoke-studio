/**
 * One server setting on the Server settings page: a switch, a set of switches, a single
 * choice or a number of minutes, with what the server's own setting is when the owner has
 * changed it here.
 */

import React, { useEffect, useId, useState } from 'react';
import type { ServerSettingOption, ServerSettingValue, ServerSettingsState } from '../../types';
import {
  SettingDefinition,
  SettingDraft,
  canTurnOff,
  describeValue,
  isResetPending,
  offeredOptions,
  shownValue,
} from '../../utils/serverSettings';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { VisuallyHidden } from '../ui/VisuallyHidden';

export interface SettingRowProps {
  setting: SettingDefinition;
  state: ServerSettingsState;
  draft: SettingDraft;
  disabled?: boolean;
  onChange: (id: string, value: ServerSettingValue) => void;
  onReset: (id: string) => void;
}

/** Whole minutes typed into a field. What is typed stays as typed; only a whole number in
 * range becomes the setting's value. */
const MinutesField: React.FC<{
  id: string;
  value: number;
  max: number;
  describedBy: string;
  disabled: boolean;
  onChange: (value: number) => void;
}> = ({ id, value, max, describedBy, disabled, onChange }) => {
  const [text, setText] = useState(String(value));
  // Follows the value when it changes from outside (a save, a reset)
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() ? current : String(value)));
  }, [value]);
  const typed = text.trim();
  const valid = /^\d+$/.test(typed) && Number(typed) <= max;

  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={text}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={!valid}
        className="w-32 tabular-nums"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (/^\d+$/.test(next.trim()) && Number(next) <= max) onChange(Number(next));
        }}
      />
      {!valid && (
        <p role="alert" className="text-sm text-theme-danger">
          Enter a whole number from 0 to {max}.
        </p>
      )}
    </div>
  );
};

export const SettingRow: React.FC<SettingRowProps> = ({
  setting,
  state,
  draft,
  disabled = false,
  onChange,
  onReset,
}) => {
  const baseId = useId().replace(/:/g, '');
  const titleId = `setting-${baseId}-title`;
  const textId = `setting-${baseId}-text`;
  const entry = state.settings[setting.id];
  const value = shownValue(state, draft, setting.id);
  const options: ServerSettingOption[] = entry.options ?? [];
  const resetPending = isResetPending(draft, setting.id);
  const cloudDown =
    setting.cloud && value === true && !state.cloud.ready ? state.cloud.reason : null;

  let control: React.ReactNode;
  if (setting.kind === 'flag') {
    control = (
      <Switch
        checked={value === true}
        onChange={(on) => onChange(setting.id, on)}
        label={setting.title}
        description={setting.text}
        disabled={disabled}
        testId={`setting-${setting.id}`}
      />
    );
  } else if (setting.kind === 'set') {
    const on = Array.isArray(value) ? value : [];
    control = (
      <div role="group" aria-labelledby={titleId} aria-describedby={textId}>
        <p id={titleId} className="text-sm font-medium text-theme-text">
          {setting.title}
        </p>
        <p id={textId} className="text-xs text-theme-text-muted">
          {setting.text}
        </p>
        <div className="mt-1 pl-4">
          {options.map((option) => (
            <Switch
              key={option.id}
              checked={on.includes(option.id)}
              onChange={(checked) =>
                onChange(
                  setting.id,
                  // In the options' own order, whatever order they were switched on in
                  options
                    .map((each) => each.id)
                    .filter((id) => (id === option.id ? checked : on.includes(id)))
                )
              }
              label={
                <>
                  <VisuallyHidden>{setting.title}: </VisuallyHidden>
                  {option.label}
                </>
              }
              description={option.note}
              disabled={disabled || (on.includes(option.id) && !canTurnOff(setting, on, option.id))}
              testId={`setting-${setting.id}-${option.id}`}
            />
          ))}
        </div>
      </div>
    );
  } else if (setting.kind === 'choice') {
    const offered = offeredOptions(state, draft, setting);
    const chosen = offered.find((option) => option.id === value) ?? offered[0];
    control = (
      <div className="space-y-2">
        <div>
          <p id={titleId} className="text-sm font-medium text-theme-text">
            {setting.title}
          </p>
          <p id={textId} className="text-xs text-theme-text-muted">
            {setting.text}
          </p>
        </div>
        {chosen && (
          <>
            {/* A default is a choice, not something lit: the neutral underline, not yellow */}
            <SegmentedControl<string>
              value={chosen.id}
              onChange={(next) => onChange(setting.id, next)}
              semantics="radio"
              tone="neutral"
              size="sm"
              ariaLabel={setting.title}
              testId={`setting-${setting.id}`}
              className="flex-wrap"
              // A short name ("Fast") is still a full-size tap target
              optionClassName="min-w-[44px]"
              options={offered.map((option) => ({
                value: option.id,
                label: option.label,
                title: option.note,
                disabled,
                testId: `setting-${setting.id}-${option.id}`,
              }))}
            />
            {chosen.note && <p className="text-xs text-theme-text-muted">{chosen.note}</p>}
          </>
        )}
      </div>
    );
  } else {
    control = (
      <div className="space-y-2">
        <div>
          <label htmlFor={titleId} className="block text-sm font-medium text-theme-text">
            {setting.title}
          </label>
          <p id={textId} className="text-xs text-theme-text-muted">
            {setting.text}
          </p>
        </div>
        <MinutesField
          id={titleId}
          value={typeof value === 'number' ? value : 0}
          max={setting.max ?? 0}
          describedBy={textId}
          disabled={disabled}
          onChange={(minutes) => onChange(setting.id, minutes)}
        />
      </div>
    );
  }

  return (
    <li className="py-3" data-testid={`setting-row-${setting.id}`}>
      {control}
      {cloudDown && (
        <p className="mt-1 text-sm text-theme-warning">
          The cloud cannot be asked from this server: {cloudDown}.
        </p>
      )}
      {/* Only a setting changed here says so: the server's own settings carry no label */}
      {entry.overridden && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-text-muted">
          {resetPending ? (
            <span>Goes back to the server&apos;s own setting when you save.</span>
          ) : (
            <>
              <span>
                Changed here. The server&apos;s own setting is{' '}
                <span className="text-theme-text">
                  {describeValue(setting, entry.default, options)}
                </span>
                .
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Reset ${setting.title}`}
                onClick={() => onReset(setting.id)}
              >
                Reset
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
};
