import styles from "../styles/preferences.module.css";

export interface PreferenceToggleProps {
	/** Current toggle state. */
	checked: boolean;
	/** Disables the toggle (greyed-out, no interaction). */
	disabled?: boolean;
	/** Fires when the user clicks the toggle. */
	onChange: (enabled: boolean) => void;
	/** CSS class override for the toggle element. */
	className?: string;
	/** Accessible label describing the toggle. */
	"aria-label"?: string;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Accessible toggle switch for a single channel preference.
 *
 * Renders as `<button role="switch">` with `aria-checked` for full
 * screen-reader support.
 */
export function PreferenceToggle({
	checked,
	disabled = false,
	onChange,
	className,
	"aria-label": ariaLabel,
}: PreferenceToggleProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			className={joinClassNames(
				styles.toggle,
				checked ? styles.toggleChecked : undefined,
				disabled ? styles.toggleDisabled : undefined,
				className,
			)}
			onClick={() => onChange(!checked)}
		>
			<span className={styles.toggleThumb} />
		</button>
	);
}
