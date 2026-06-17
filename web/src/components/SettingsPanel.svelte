<script lang="ts">
  let {
    open = false,
    target = "1.1.1.1",
    pingInterval = 1,
    retention = 180,
    saving = false,
    error = "",
    onclose,
    onsave,
  }: {
    open?: boolean;
    target?: string;
    pingInterval?: number;
    retention?: number;
    saving?: boolean;
    error?: string;
    onclose?: () => void;
    onsave?: (values: { target: string; ping_interval_seconds: number; retention_minutes: number }) => void;
  } = $props();

  let draftTarget = $state("");
  let draftInterval = $state(1);
  let draftRetention = $state(180);

  $effect(() => {
    if (open) {
      draftTarget = target;
      draftInterval = pingInterval;
      draftRetention = retention;
    }
  });

  function submit(event: Event) {
    event.preventDefault();
    onsave?.({
      target: draftTarget.trim(),
      ping_interval_seconds: Number(draftInterval),
      retention_minutes: Number(draftRetention),
    });
  }
</script>

{#if open}
  <div class="overlay" role="presentation" onclick={onclose}></div>
  <aside class="settings-panel" aria-label="Settings">
    <header>
      <h2>Settings</h2>
      <button type="button" class="ghost" onclick={onclose}>Close</button>
    </header>
    <form onsubmit={submit}>
      <label>
        Ping target
        <input bind:value={draftTarget} required />
      </label>
      <label>
        Interval (seconds)
        <input type="number" min="0.25" max="60" step="0.25" bind:value={draftInterval} required />
      </label>
      <label>
        Retention (minutes)
        <input type="number" min="5" max="1440" step="1" bind:value={draftRetention} required />
      </label>
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
    </form>
  </aside>
{/if}

<style>
  .settings-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: min(360px, 100%);
    height: 100%;
    background: var(--color-surface);
    border-left: 1px solid var(--color-border);
    padding: var(--space-4);
    z-index: 10;
  }

  .settings-panel header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }

  .settings-panel form {
    display: grid;
    gap: var(--space-4);
  }

  .settings-panel label {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-muted);
  }
</style>
