<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import * as Dialog from "$lib/components/ui/dialog";
    import { FileCard } from "source-application";

    export let open: boolean = false;
    export let solverId: string | undefined = undefined;
    export let sources: any[] = [];
    export let profile: any | null = null;
    export let explorerUri: string = "";
    export let sourceExplorerUrl: string = "";
    export let webExplorerUriTkn: string = "";

    function closeModal() {
        open = false;
    }
</script>

<Dialog.Root bind:open>
    <Dialog.Content class="sm:max-w-[700px] lg:max-w-[1000px]">
        <Dialog.Header>
            <Dialog.Title>Solver Source</Dialog.Title>
            <Dialog.Description>
                Source code for this participation's solver.
            </Dialog.Description>
        </Dialog.Header>

        <div class="py-4">
            {#if solverId}
                <FileCard
                    {profile}
                    fileHash={solverId}
                    {sources}
                    {explorerUri}
                    source_explorer_url={sourceExplorerUrl}
                    {webExplorerUriTkn}
                />
            {:else}
                <p class="text-muted-foreground">No solver ID found.</p>
            {/if}
        </div>

        <Dialog.Footer>
            <Button variant="outline" on:click={closeModal}>Close</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
