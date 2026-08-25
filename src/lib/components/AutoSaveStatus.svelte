<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let lastSaved: Date | null = null;
	let showSaving = false;
	let displayTime = '';
	let updateInterval: NodeJS.Timeout;

	// Listen for custom save events
	onMount(() => {
		const handleSaveEvent = () => {
			lastSaved = new Date();
			showSaving = true;

			// Hide the "Saving..." indicator after a short delay
			setTimeout(() => {
				showSaving = false;
			}, 1500);

			updateDisplayTime();
		};

		// Listen for custom save events from the stores
		window.addEventListener('autosave', handleSaveEvent as EventListener);

		// Update display time every 30 seconds
		updateInterval = setInterval(() => {
			updateDisplayTime();
		}, 30000);

		return () => {
			window.removeEventListener('autosave', handleSaveEvent as EventListener);
		};
	});

	onDestroy(() => {
		if (updateInterval) {
			clearInterval(updateInterval);
		}
	});

	function updateDisplayTime() {
		if (!lastSaved) {
			displayTime = '';
			return;
		}

		const now = new Date();
		const diffMs = now.getTime() - lastSaved.getTime();
		const diffMinutes = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMinutes / 60);

		if (diffMinutes < 1) {
			displayTime = 'Just now';
		} else if (diffMinutes < 60) {
			displayTime = `${diffMinutes}m ago`;
		} else if (diffHours < 24) {
			displayTime = `${diffHours}h ago`;
		} else {
			// Show full date and time for older saves
			displayTime =
				lastSaved.toLocaleDateString() +
				' ' +
				lastSaved.toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit'
				});
		}
	}

	// Expose function to trigger save indicator from outside
	export function triggerSave() {
		lastSaved = new Date();
		showSaving = true;

		// Dispatch custom event
		window.dispatchEvent(new CustomEvent('autosave'));

		setTimeout(() => {
			showSaving = false;
		}, 1500);

		updateDisplayTime();
	}
</script>

{#if showSaving || lastSaved}
	<div class="autosave-status" class:saving={showSaving}>
		{#if showSaving}
			<div class="save-indicator">
				<svg
					class="spinner"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M21 12a9 9 0 11-6.219-8.56" />
				</svg>
				<span class="save-text">Saving...</span>
			</div>
		{:else if displayTime}
			<div class="save-indicator saved">
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
				<span class="save-text">Saved {displayTime}</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.autosave-status {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 1000;
		pointer-events: none;
	}

	.save-indicator {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 0.75rem;
		color: var(--text-secondary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		backdrop-filter: blur(8px);
		transition: all 0.3s ease;
	}

	.save-indicator.saved {
		color: var(--success);
		border-color: var(--success);
		background: var(--success-bg);
	}

	.autosave-status.saving .save-indicator {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--accent-bg);
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.save-text {
		font-weight: 500;
		white-space: nowrap;
	}

	/* Animation for appearance */
	.autosave-status {
		animation: slideInUp 0.3s ease-out;
	}

	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.autosave-status {
			bottom: 0.5rem;
			right: 0.5rem;
		}

		.save-indicator {
			padding: 0.375rem 0.5rem;
			font-size: 0.7rem;
		}
	}
</style>
