import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  IconButton,
  SegmentedControl,
  Tabs,
  Dialog,
  DialogHeader,
  DialogFooter,
  Menu,
  Slider,
  Switch,
  Checkbox,
  ProgressBar,
  ProgressRing,
  Panel,
  Kbd,
  Badge,
  EmptyState,
} from '../../components/ui';
import { expectTouchTarget } from '../responsiveTestUtils';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';

describe('Button', () => {
  it('renders a typed button with a 44px touch target and fires clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    expectTouchTarget(btn, 44);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables and marks busy while loading, showing the loading label', () => {
    render(
      <Button loading loadingLabel="Saving…">
        Save
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Saving…' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('supports full width on mobile only', () => {
    render(<Button fullWidth="mobile">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toMatch(/w-full sm:w-auto/);
  });
});

describe('IconButton', () => {
  it('exposes the label as accessible name and reflects pressed state', () => {
    render(<IconButton icon={<span>i</span>} label="Beat visualizer" pressed tooltip={false} />);
    const btn = screen.getByRole('button', { name: 'Beat visualizer' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expectTouchTarget(btn, 44);
    expect(btn.className).toContain('min-w-[44px]');
  });

  it('omits aria-pressed for non-toggle buttons and shows a tooltip on focus', () => {
    render(<IconButton icon={<span>i</span>} label="Restart" tooltip="Restart track" />);
    const btn = screen.getByRole('button', { name: 'Restart' });
    expect(btn).not.toHaveAttribute('aria-pressed');
    act(() => btn.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Restart track');
  });
});

describe('SegmentedControl', () => {
  const Harness: React.FC<{ semantics: 'radio' | 'toggle' }> = ({ semantics }) => {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return (
      <SegmentedControl
        ariaLabel="Mode"
        semantics={semantics}
        value={v}
        onChange={setV}
        options={[
          { value: 'a', label: 'Alpha', testId: 'opt-a' },
          { value: 'b', label: 'Beta', testId: 'opt-b' },
          { value: 'c', label: 'Gamma', testId: 'opt-c' },
        ]}
      />
    );
  };

  it('implements radiogroup semantics with roving focus and arrow keys', () => {
    render(<Harness semantics="radio" />);
    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(group).toBeInTheDocument();
    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-checked', 'true');
    expect(alpha).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Beta' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
  });

  it('implements toggle-group semantics with aria-pressed', () => {
    render(<Harness semantics="toggle" />);
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('opt-c'));
    expect(screen.getByTestId('opt-c')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('opt-a')).toHaveAttribute('aria-pressed', 'false');
    expectTouchTarget(screen.getByTestId('opt-a'), 44);
  });
});

describe('Tabs', () => {
  it('renders WAI-ARIA tabs with custom ids and keyboard navigation', () => {
    const Harness = () => {
      const [v, setV] = useState<'one' | 'two'>('one');
      return (
        <Tabs
          ariaLabel="Topics"
          value={v}
          onChange={setV}
          getTabId={(id) => `tab-${id}`}
          items={[
            { id: 'one', label: 'One', controls: 'panel-one' },
            { id: 'two', label: 'Two', controls: 'panel-two' },
          ]}
        />
      );
    };
    render(<Harness />);
    const one = screen.getByRole('tab', { name: 'One' });
    expect(one).toHaveAttribute('id', 'tab-one');
    expect(one).toHaveAttribute('aria-controls', 'panel-one');
    expect(one).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    const two = screen.getByRole('tab', { name: 'Two' });
    expect(two).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(two, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Dialog', () => {
  const Demo: React.FC<{
    open?: boolean;
    onClose?: () => void;
    layer?: 'modal' | 'gate';
    dismissOnBackdrop?: boolean;
    dismissOnEscape?: boolean;
  }> = ({ open = true, onClose = () => {}, ...rest }) => (
    <Dialog
      open={open}
      onClose={onClose}
      titleId="demo-title"
      descriptionId="demo-desc"
      showDragHandle
      {...rest}
    >
      <DialogHeader
        title="Demo Dialog"
        titleId="demo-title"
        description="Demo description"
        descriptionId="demo-desc"
        onClose={onClose}
        closeLabel="Close demo dialog"
      />
      <p>Body</p>
      <DialogFooter>
        <Button>Cancel</Button>
        <Button variant="primary">Confirm</Button>
      </DialogFooter>
    </Dialog>
  );

  it('renders nothing while closed (keeps global shortcuts enabled)', () => {
    render(<Demo open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isModalActive()).toBe(false);
  });

  it('puts role=dialog + aria-modal on the overlay with the card as first child', () => {
    render(<Demo />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'demo-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'demo-desc');
    expect(dialog.className).toMatch(/items-end sm:items-center p-0 sm:p-4/);
    const card = dialog.firstElementChild as HTMLElement;
    expect(card.className).toMatch(/rounded-t-2xl rounded-b-none/);
    expect(card.className).toContain('max-h-[90vh]');
    expect(card.className).toContain('overflow-y-auto');
    expect(screen.getByTestId('bottom-sheet-drag-handle').className).toMatch(/sm:hidden/);
    expect(screen.getByRole('heading', { name: 'Demo Dialog' })).toHaveAttribute(
      'id',
      'demo-title'
    );
  });

  it('focuses the close button first and closes on Escape and backdrop click', () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close demo dialog' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('gate layer ignores Escape and backdrop clicks', () => {
    const onClose = vi.fn();
    render(
      <Demo onClose={onClose} layer="gate" dismissOnBackdrop={false} dismissOnEscape={false} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('z-[100]');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stacks footer actions reversed on mobile', () => {
    render(<Demo />);
    const footer = screen.getByRole('button', { name: 'Confirm' }).parentElement as HTMLElement;
    expect(footer.className).toMatch(/flex-col-reverse/);
    expect(footer.className).toMatch(/sm:flex-row/);
  });
});

describe('Menu', () => {
  it('opens a role=menu, navigates with arrows, selects and restores focus', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <Menu
        label="Line actions"
        items={[
          { id: 'edit', label: 'Edit', onSelect: onEdit },
          { id: 'delete', label: 'Delete', onSelect: onDelete, tone: 'danger' },
        ]}
        trigger={(props) => (
          <button type="button" {...props}>
            More
          </button>
        )}
      />
    );
    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Line actions' });
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    const parentKeydown = vi.fn();
    window.addEventListener('keydown', parentKeydown);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(parentKeydown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', parentKeydown);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape without selecting', () => {
    const onEdit = vi.fn();
    render(
      <Menu
        label="Actions"
        items={[{ id: 'edit', label: 'Edit', onSelect: onEdit }]}
        trigger={(props) => (
          <button type="button" {...props}>
            Open
          </button>
        )}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('Slider', () => {
  it('reports changes, commits on interaction end, and exposes value text', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const Harness = () => {
      const [v, setV] = useState(0.2);
      return (
        <Slider
          label="Guide vocal level"
          value={v}
          min={0}
          max={0.5}
          step={0.05}
          onChange={(next) => {
            onChange(next);
            setV(next);
          }}
          onChangeEnd={onChangeEnd}
          valueText={(val) => `${Math.round(val * 100)}%`}
        />
      );
    };
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Guide vocal level' });
    expect(slider).toHaveAttribute('aria-valuetext', '20%');
    expect((slider as HTMLInputElement).style.getPropertyValue('--ks-range-fill')).toBe('40.00%');
    fireEvent.change(slider, { target: { value: '0.35' } });
    expect(onChange).toHaveBeenCalledWith(0.35);
    fireEvent.pointerUp(slider);
    expect(onChangeEnd).toHaveBeenCalledWith(0.35);
    expectTouchTarget(slider, 44);
  });
});

describe('Switch & Checkbox', () => {
  it('Switch toggles aria-checked', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onChange={setOn} label="Countdown cues" />;
    };
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Countdown cues' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('Checkbox is a native labelled checkbox', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Include chords" />);
    const cb = screen.getByRole('checkbox', { name: 'Include chords' });
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Progress', () => {
  it('ProgressBar and ProgressRing expose progressbar semantics', () => {
    render(
      <>
        <ProgressBar value={42} label="Upload progress" />
        <ProgressRing value={73} label="Processing progress" />
      </>
    );
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    );
    expect(screen.getByRole('progressbar', { name: 'Processing progress' })).toHaveAttribute(
      'aria-valuenow',
      '73'
    );
  });
});

describe('Panel', () => {
  it('labels the region by its title and persists collapsed state', () => {
    const { unmount } = render(
      <Panel title="Audio Mix" collapsible storageKey="test-mix">
        <p>Mix body</p>
      </Panel>
    );
    expect(screen.getByRole('region', { name: 'Audio Mix' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /audio mix/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Mix body')).not.toBeVisible();
    unmount();
    render(
      <Panel title="Audio Mix" collapsible storageKey="test-mix">
        <p>Mix body</p>
      </Panel>
    );
    expect(screen.getByRole('button', { name: /audio mix/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});

describe('Kbd, Badge, EmptyState', () => {
  it('renders keyboard keys and maps Mod to a platform label', () => {
    const { container } = render(<Kbd keys={['Mod', 'K']} />);
    const kbds = container.querySelectorAll('kbd');
    expect(kbds).toHaveLength(2);
    expect(['⌘', 'Ctrl']).toContain(kbds[0].textContent);
    expect(kbds[1].textContent).toBe('K');
  });

  it('renders badges and empty states', () => {
    render(
      <>
        <Badge tone="success" dot>
          Ready
        </Badge>
        <EmptyState title="No songs yet" description="Add your first track" />
      </>
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('No songs yet')).toBeInTheDocument();
  });
});
