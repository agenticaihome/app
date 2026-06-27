<script context="module" lang="ts">
    let activeLocks = 0;
    let previousBodyOverflow = "";
    let previousHtmlOverflow = "";

    function applyScrollLock() {
        if (typeof document === "undefined") return;

        if (activeLocks === 1) {
            previousBodyOverflow = document.body.style.overflow;
            previousHtmlOverflow = document.documentElement.style.overflow;
        }

        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
    }

    function releaseScrollLock() {
        if (typeof document === "undefined" || activeLocks !== 0) return;

        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
    }
</script>

<script lang="ts">
    import { onDestroy } from "svelte";

    export let active = true;

    let locked = false;

    function syncLock(nextActive: boolean) {
        if (nextActive && !locked) {
            activeLocks += 1;
            locked = true;
            applyScrollLock();
            return;
        }

        if (!nextActive && locked) {
            activeLocks = Math.max(0, activeLocks - 1);
            locked = false;
            releaseScrollLock();
        }
    }

    $: syncLock(active);

    onDestroy(() => {
        syncLock(false);
    });
</script>
