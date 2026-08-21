import '../src/lib/load-env';
import { rebuildDerivedValues } from '../src/lib/flock-service';

/**
 * Rebuild every derived value from the event ledger.
 *
 * The architecture promises that caches are disposable — that `currentStageId`
 * and the snapshot tables can be thrown away and reconstructed from first
 * principles. This is that promise, executable. Being able to run it is what
 * makes it safe to denormalise anything at all.
 *
 *   npm run rebuild:derived
 */
async function main() {
  console.log('Rebuilding derived values from the ledger…');
  const result = await rebuildDerivedValues();
  console.log(`  ✓ ${result.groups} flock(s) checked`);
  console.log(
    result.stagesFixed === 0
      ? '  ✓ every cached stage already matched the ledger'
      : `  ✓ ${result.stagesFixed} cached stage(s) corrected`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
