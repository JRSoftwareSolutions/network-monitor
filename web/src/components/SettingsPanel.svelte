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

  let draftTarget = $state(target);
  let draftInterval = $state(pingInterval);
  let draftRetention = $state(retention);

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
