<script lang="ts">
  // family fork: a birth or death date with as much as is known: just the year, the month and year, or
  // the exact day. The value is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' ('' when unknown).
  type Precision = 'year' | 'month' | 'day';
  type Props = { value: string; label: string };
  let { value = $bindable(), label }: Props = $props();

  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(2000, index, 1).toLocaleDateString(undefined, { month: 'long' }),
  );

  const precision = $derived<Precision>(value.length === 4 ? 'year' : value.length === 7 ? 'month' : 'day');
  const year = $derived(value.slice(0, 4));
  const month = $derived(value.slice(5, 7) || '01');

  const setPrecision = (next: Precision) => {
    if (!value) {
      return;
    }
    const [y, m = '01', d = '01'] = value.split('-', 3);
    value = next === 'year' ? y : next === 'month' ? `${y}-${m}` : `${y}-${m}-${d}`;
  };
  const setYear = (next: string) => {
    const clean = next.replaceAll(/\D/g, '').slice(0, 4);
    if (clean.length < 4) {
      return;
    }
    value = precision === 'month' ? `${clean}-${month}` : clean;
  };
  const field = 'rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800';
</script>

<fieldset class="flex flex-col gap-1">
  <legend class="text-sm font-medium">{label}</legend>
  {#if !value}
    <div class="flex gap-2">
      <button type="button" class="{field} text-start" onclick={() => (value = String(new Date().getFullYear() - 50))}>
        Add a year
      </button>
      <input
        type="date"
        class={field}
        aria-label="{label}, exact date"
        onchange={(event) => (value = event.currentTarget.value)}
      />
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <select
        class={field}
        aria-label="How much of the {label.toLowerCase()} date is known"
        value={precision}
        onchange={(event) => setPrecision(event.currentTarget.value as Precision)}
      >
        <option value="year">Year</option>
        <option value="month">Month and year</option>
        <option value="day">Exact date</option>
      </select>
      {#if precision === 'day'}
        <input type="date" class={field} aria-label={label} bind:value />
      {:else}
        {#if precision === 'month'}
          <select
            class={field}
            aria-label="{label}, month"
            value={month}
            onchange={(event) => (value = `${year}-${event.currentTarget.value}`)}
          >
            {#each months as name, index (name)}
              <option value={String(index + 1).padStart(2, '0')}>{name}</option>
            {/each}
          </select>
        {/if}
        <input
          class="{field} w-24"
          inputmode="numeric"
          aria-label="{label}, year"
          value={year}
          oninput={(event) => setYear(event.currentTarget.value)}
        />
      {/if}
      <button type="button" class="text-sm text-gray-500 underline" onclick={() => (value = '')}>Clear</button>
    </div>
  {/if}
</fieldset>
