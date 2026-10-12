import '../src/lib/load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { demoCycle, bodyWeightGrams, rng, jitter } from '../src/lib/demo-curves';

/**
 * The demo farm — ADRAH Farms
 *
 *   npm run demo:seed            eighteen months of a flock that never existed
 *   npm run demo:seed -- --days 240
 *   npm run demo:clear           remove it again
 *
 * WHY THIS EXISTS. There are no birds yet, so every screen in this system is
 * empty and nobody can tell a working dashboard from a broken one. This builds
 * a flock's whole history — placed, reared, brought into lay, sold from, paid
 * for — so the farm can walk its own software before buying a single chick.
 *
 * ── THE LINE IT MUST NOT CROSS ─────────────────────────────────────────────
 *
 * It invents a flock's HISTORY. It does not invent a breed's STANDARD. Every
 * "vs standard" column still reads a dash until somebody pastes the breeder's
 * own table in — which is the honest behaviour and a better demonstration than
 * a fabricated comparison, because it shows the software admitting what it does
 * not know.
 *
 * ── AND THE ONE THAT WOULD BE UNRECOVERABLE ────────────────────────────────
 *
 * THIS MUST NEVER RUN AGAINST THE REAL DATABASE. Three hundred days of invented
 * records mixed into the real first flock cannot be told apart afterwards —
 * not by this script, not by anybody. So it refuses to run where operating data
 * already exists, it prints the database it is about to write to, and it asks
 * out loud before touching anything that is not on this machine.
 *
 * Put it on a scratch database. docs/DEMO.md explains how to make one from a
 * Neon branch in about a minute, which costs nothing and risks nothing.
 */

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const args = process.argv.slice(2);
const clearing = args.includes('--clear');
const force = args.includes('--force');
const daysArg = args.indexOf('--days');
const DAYS = daysArg === -1 ? 400 : Math.max(30, Math.min(600, Number(args[daysArg + 1]) || 400));
const PLACED = 1000;

const host = (() => {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return 'unknown';
  }
})();
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

const DAY = 86_400_000;
const dayAgo = (n: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - n * DAY);
};

// ---------------------------------------------------------------------------
// THE TABLES THE DEMO OWNS
// ---------------------------------------------------------------------------

/**
 * Operating data, in foreign-key order.
 *
 * NOT the reference seed — units, roles, permissions, the organisation, the
 * site, the houses, the species, the grades, the breeds and the user accounts
 * all survive. Those describe how this farm is set up; everything below
 * describes what it did, and only the second kind is invented here.
 */
const OPERATING_TABLES = [
  'Payment',
  'DispatchLine',
  'Dispatch',
  'SalesOrderLine',
  'SalesOrder',
  'ProductPrice',
  'Product',
  'Customer',
  'StockTakeLine',
  'StockTake',
  'ProductionLine',
  'ProductionRecord',
  'DailyRecord',
  'WeightSample',
  'FlockCostEntry',
  'HealthEvent',
  'StockMovement',
  'ItemBatch',
  'AnimalGroupEvent',
  'AnimalGroup',
] as const;

async function operatingRowCount(): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ c: bigint }[]>(
    OPERATING_TABLES.map((t) => `SELECT count(*) AS c FROM "${t}"`).join(' UNION ALL '),
  );
  return rows.reduce((sum, r) => sum + Number(r.c), 0);
}

async function clearOperatingData() {
  for (const table of OPERATING_TABLES) {
    await db.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  // The grades' link to a store item is part of the demo's setup, not the seed's.
  await db.$executeRawUnsafe(`UPDATE "ProductionGrade" SET "itemId" = NULL`);
  await db.$executeRawUnsafe(`DELETE FROM "Item"`);
}

// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------

async function guard() {
  console.log(`\n  Database: ${host}\n`);

  if (!isLocal && !force) {
    console.error('  REFUSING TO RUN.\n');
    console.error('  That database is not on this machine. Invented records mixed into a real');
    console.error('  farm\'s data cannot be told apart afterwards — not by this script, not by');
    console.error('  anybody.\n');
    console.error('  Put the demo on a scratch database. docs/DEMO.md shows how to make one');
    console.error('  from a Neon branch in about a minute.\n');
    console.error('  If this IS a scratch database, re-run with --force.\n');
    process.exit(1);
  }

  const existing = await operatingRowCount();
  if (existing > 0 && !clearing) {
    console.error(`  REFUSING TO RUN.\n`);
    console.error(`  There are already ${existing.toLocaleString('en-GH')} operating rows here —`);
    console.error('  flocks, records, movements, orders. The demo will not mix itself into');
    console.error('  data that may be real.\n');
    console.error('  npm run demo:clear   removes the operating data and keeps the setup\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// BUILDING THE FARM
// ---------------------------------------------------------------------------

async function main() {
  await guard();

  if (clearing) {
    console.log('  Removing operating data…');
    await clearOperatingData();
    console.log('  Done. The organisation, site, houses, species, grades and accounts remain.\n');
    return;
  }

  const org = await db.organisation.findFirst();
  const site = await db.site.findFirst();
  const house = await db.productionUnit.findFirst({ orderBy: { createdAt: 'asc' } });
  const species = await db.speciesProfile.findFirst();
  const productionType = await db.productionTypeProfile.findFirst();
  const laying = await db.lifecycleStage.findFirst({ where: { key: 'laying' } });
  const owner = await db.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const grades = await db.productionGrade.findMany({ orderBy: { sortOrder: 'asc' } });
  const uom = async (key: string) => {
    const u = await db.unitOfMeasure.findFirst({ where: { key } });
    if (!u) throw new Error(`Unit "${key}" is missing. Run npm run db:seed first.`);
    return u;
  };

  if (!org || !site || !house || !species || !productionType || !laying || !owner || grades.length === 0) {
    console.error('  This database has not been set up yet. Run npm run db:seed first.\n');
    process.exit(1);
  }

  const piece = await uom('piece');
  const kg = await uom('kg');
  const crate = await uom('crate');
  const next = rng(20261012);

  console.log(`  Building ${DAYS} days of a ${PLACED}-bird flock…\n`);

  // --- the store, and what it holds ----------------------------------------
  const store = await db.stockLocation.findFirst({ where: { siteId: site.id } });
  if (!store) {
    console.error('  No store at this site. Run npm run db:seed first.\n');
    process.exit(1);
  }
  await db.stockLocation.update({
    where: { id: store.id },
    data: { receivesProduction: true },
  });

  const feedItem = await db.item.create({
    data: {
      organisationId: org.id,
      sku: 'FEED-LAYER',
      name: 'Layer mash',
      category: 'FEED',
      stockUomId: kg.id,
      reorderLevel: 500,
      minimumStock: 250,
    },
  });

  // ONE STORE ITEM PER SALEABLE GRADE, which is what makes a collection reach
  // the store at all. Cracked and floor eggs are deliberately left unlinked:
  // they are collected and counted and held as stock by nobody, which is the
  // gap the period report explains rather than reports as an error.
  const gradeItems = new Map<string, string>();
  for (const grade of grades.filter((g) => g.isSaleable)) {
    const item = await db.item.create({
      data: {
        organisationId: org.id,
        sku: `EGG-${grade.key.toUpperCase()}`,
        name: `Eggs — ${grade.name.toLowerCase()}`,
        category: 'FINISHED_PRODUCT',
        stockUomId: piece.id,
        isPerishable: true,
        shelfLifeDays: 21,
      },
    });
    await db.productionGrade.update({ where: { id: grade.id }, data: { itemId: item.id } });
    gradeItems.set(grade.id, item.id);
  }
  console.log(`  ✓ Store set to receive produce · ${gradeItems.size + 1} items`);

  // --- the flock ------------------------------------------------------------
  const hatchedOn = dayAgo(DAYS);
  const flock = await db.animalGroup.create({
    data: {
      siteId: site.id,
      productionUnitId: house.id,
      speciesProfileId: species.id,
      productionTypeProfileId: productionType.id,
      code: 'FLK-2026-01',
      dateOfHatch: hatchedOn,
      arrivalDate: dayAgo(DAYS - 1),
      currentStageId: laying.id,
      notes: 'Demonstration flock — not a real placement.',
    },
  });

  await db.animalGroupEvent.create({
    data: {
      animalGroupId: flock.id,
      type: 'PLACEMENT',
      delta: PLACED,
      occurredOn: dayAgo(DAYS - 1),
      ageDays: 1,
      recordedById: owner.id,
    },
  });

  const cycle = demoCycle(DAYS, PLACED);
  console.log(`  ✓ Flock placed ${hatchedOn.toISOString().slice(0, 10)} — ${PLACED} chicks`);

  // --- the ledgers, day by day ---------------------------------------------
  //
  // createMany in batches rather than one call each: four hundred days across
  // six tables is thousands of writes, and a round trip apiece to a hosted
  // database turns a demo into a coffee break.
  const events: Prisma.AnimalGroupEventCreateManyInput[] = [];
  const dailies: Prisma.DailyRecordCreateManyInput[] = [];
  const records: Prisma.ProductionRecordCreateManyInput[] = [];
  const lines: Prisma.ProductionLineCreateManyInput[] = [];
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  const costs: Prisma.FlockCostEntryCreateManyInput[] = [];
  const weights: Prisma.WeightSampleCreateManyInput[] = [];
  const movementsOut: Prisma.StockMovementCreateManyInput[] = [];

  // Feed arrives in deliveries, not continuously. Each becomes a batch with a
  // real price, so flock costing has something to draw from.
  let feedOnHand = 0;
  let deliveryNo = 0;

  for (const day of cycle) {
    const onDate = dayAgo(DAYS - day.ageDays);
    const iso = onDate.toISOString().slice(0, 10);

    if (day.deaths > 0) {
      events.push({
        animalGroupId: flock.id,
        type: 'MORTALITY',
        delta: -day.deaths,
        occurredOn: onDate,
        ageDays: day.ageDays,
        reasonCode: day.ageDays <= 14 ? 'chilling' : 'unknown',
        recordedById: owner.id,
      });
    }
    if (day.culls > 0) {
      events.push({
        animalGroupId: flock.id,
        type: 'CULL',
        delta: -day.culls,
        occurredOn: onDate,
        ageDays: day.ageDays,
        reasonCode: 'poor_condition',
        recordedById: owner.id,
      });
    }

    dailies.push({
      productionUnitId: house.id,
      animalGroupId: flock.id,
      onDate,
      idempotencyKey: `demo-daily-${day.ageDays}`,
      feedKg: day.feedKg,
      waterLitres: day.waterLitres,
      recordedById: owner.id,
    });

    // --- feed: a delivery when the store runs low, then the day's issue -----
    if (feedOnHand < day.feedKg * 10) {
      deliveryNo += 1;
      const bags = 40; // 2,000 kg
      const kgIn = bags * 50;
      // GHS 290–320 a bag, which is the order of magnitude in Ashanti.
      const perBagPesewas = Math.round(jitter(30500, 0.05, next) / 50) * 50;
      const batch = await db.itemBatch.create({
        data: {
          itemId: feedItem.id,
          batchNumber: `FEED-${iso}-${deliveryNo}`,
          unitCostPesewas: Math.round(perBagPesewas / 50),
          receivedOn: onDate,
        },
      });
      movements.push({
        itemId: feedItem.id,
        itemBatchId: batch.id,
        stockLocationId: store.id,
        type: 'PURCHASE_RECEIPT',
        deltaBase: kgIn,
        enteredQuantity: bags,
        enteredUomId: kg.id,
        occurredOn: onDate,
        notes: `Delivery ${deliveryNo} — ${bags} bags`,
        recordedById: owner.id,
      });
      feedOnHand += kgIn;
      costs.push({
        animalGroupId: flock.id,
        category: 'FEED',
        amountPesewas: perBagPesewas * bags,
        incurredOn: onDate,
        description: `${bags} bags of layer mash`,
        recordedById: owner.id,
      });
    }

    if (day.feedKg > 0 && feedOnHand >= day.feedKg) {
      movements.push({
        itemId: feedItem.id,
        stockLocationId: store.id,
        type: 'ISSUE',
        deltaBase: -day.feedKg,
        enteredQuantity: day.feedKg,
        enteredUomId: kg.id,
        occurredOn: onDate,
        sourceType: 'dailyRecord',
        recordedById: owner.id,
      });
      feedOnHand -= day.feedKg;
    }

    // --- the collection -----------------------------------------------------
    if (day.eggs > 0) {
      const recordId = `demo-prod-${day.ageDays}`;
      records.push({
        id: recordId,
        animalGroupId: flock.id,
        productionUnitId: house.id,
        onDate,
        sequence: 1,
        ageDays: day.ageDays,
        countedBase: day.eggs,
        countedEntered: day.eggs,
        countedUomId: piece.id,
        idempotencyKey: `demo-collect-${day.ageDays}`,
        recordedById: owner.id,
      });

      for (const grade of grades) {
        const quantity = day.grades[grade.key] ?? 0;
        if (quantity <= 0) continue;
        lines.push({
          productionRecordId: recordId,
          productionGradeId: grade.id,
          quantityBase: quantity,
          enteredQuantity: quantity,
          enteredUomId: piece.id,
        });

        // Only the grades somebody holds as stock reach the store.
        const itemId = gradeItems.get(grade.id);
        if (!itemId) continue;
        movements.push({
          itemId,
          stockLocationId: store.id,
          type: 'PRODUCTION',
          deltaBase: quantity,
          enteredQuantity: quantity,
          enteredUomId: piece.id,
          occurredOn: onDate,
          sourceType: 'ProductionRecord',
          sourceId: recordId,
          recordedById: owner.id,
        });
      }
    }

    // --- a weight sample every two weeks through rearing, monthly after -----
    const sampleDue = day.ageDays <= 126 ? day.ageDays % 14 === 0 : day.ageDays % 28 === 0;
    if (sampleDue) {
      const target = bodyWeightGrams(day.ageDays);
      weights.push({
        animalGroupId: flock.id,
        takenOn: onDate,
        ageDays: day.ageDays,
        sampleSize: 20,
        // Individual birds, so uniformity and CV% are computed rather than told.
        weightsGrams: Array.from({ length: 20 }, () =>
          Math.round(jitter(target, 0.08, next)),
        ),
        recordedById: owner.id,
      });
    }
  }

  await db.animalGroupEvent.createMany({ data: events });
  await db.dailyRecord.createMany({ data: dailies });
  await db.weightSample.createMany({ data: weights });
  await db.productionRecord.createMany({ data: records });
  await db.productionLine.createMany({ data: lines });
  await db.stockMovement.createMany({ data: movements });
  await db.flockCostEntry.createMany({ data: costs });

  console.log(
    `  ✓ ${dailies.length} daily records · ${records.length} collections · ` +
      `${movements.length} stock movements · ${weights.length} weight samples`,
  );

  // --- buyers, products and prices -----------------------------------------
  const buyers = [
    { name: 'Akosua Mensah', business: 'Mensah Cold Store', town: 'New Edubiase', kind: 'WHOLESALE' as const, phone: '+233244010111' },
    { name: 'Kwame Boateng', business: 'Boateng Provisions', town: 'Obuasi', kind: 'WHOLESALE' as const, phone: '+233244010222' },
    { name: 'Adwoa Serwaa', business: null, town: 'New Edubiase', kind: 'RETAIL' as const, phone: '+233244010333' },
    { name: 'Yaw Antwi', business: 'Antwi Chop Bar', town: 'Fomena', kind: 'RETAIL' as const, phone: '+233244010444' },
  ];

  const customers = [];
  for (const b of buyers) {
    customers.push(
      await db.customer.create({
        data: {
          organisationId: org.id,
          kind: b.kind,
          name: b.name,
          phone: b.phone,
          businessName: b.business,
          town: b.town,
          createdById: owner.id,
        },
      }),
    );
  }

  // A crate of thirty, per saleable grade, priced the way a Ghanaian farm does.
  const PRICE_PER_CRATE: Record<string, number> = {
    pullet: 4200,
    small: 4800,
    medium: 5400,
    large: 6000,
    extra_large: 6500,
  };

  const products = [];
  for (const grade of grades.filter((g) => g.isSaleable)) {
    const product = await db.product.create({
      data: {
        organisationId: org.id,
        sku: `CRATE-${grade.key.toUpperCase()}`,
        name: `Crate of ${grade.name.toLowerCase()} eggs`,
        gradeId: grade.id,
        unitsPerPack: 30,
        packLabel: 'crate',
      },
    });
    await db.productPrice.create({
      data: {
        organisationId: org.id,
        productId: product.id,
        pricePesewas: PRICE_PER_CRATE[grade.key] ?? 5400,
        effectiveFrom: dayAgo(DAYS - 119),
        note: 'Opening list price',
        setById: owner.id,
      },
    });
    products.push({ product, grade });
  }
  console.log(`  ✓ ${customers.length} buyers · ${products.length} products with list prices`);

  // --- orders, loads and money ---------------------------------------------
  //
  // ONE ORDER A DAY, SIZED TO CLEAR WHAT WAS COLLECTED.
  //
  // The first version sold a fixed fourteen crates every third day, which left
  // a hundred and seventy thousand eggs sitting in the store — about six
  // thousand crates, months past eating. A demo that accumulates stock forever
  // makes every store, report and cost screen quietly wrong, so the orders are
  // now drawn from the previous day's saleable production.
  //
  // It sells in whole crates and only from grades a buyer wants, so a few days'
  // worth is always still on the shelf. That remainder is the point: "unsold" is
  // a real figure on the report, not a rounding artefact.
  let orderNo = 0;
  let dispatchNo = 0;
  let paymentNo = 0;
  // EVERY SALEABLE GRADE, pullet eggs included. Excluding them left every small
  // egg the flock laid in its first weeks sitting in the store for ever — they
  // are small and cheap, not unsellable.
  const sellable = products;
  const gradeByKey = new Map(sellable.map((p) => [p.grade.key, p]));

  /**
   * YESTERDAY'S PART-CRATE IS TODAY'S.
   *
   * Selling `floor(eggs / 30)` each day leaves up to twenty-nine of every grade
   * behind, every day, for ever — which added up to twenty-two thousand eggs on
   * the shelf, about a month of production that no farm would be holding. The
   * remainder is carried forward instead, which is what actually happens: a
   * part-crate waits for tomorrow's eggs to fill it.
   */
  const pending = new Map<string, number>();

  for (const day of cycle) {
    if (day.ageDays < 126 || day.eggs === 0) continue;
    const onDate = dayAgo(DAYS - day.ageDays);
    const buyer = customers[orderNo % customers.length];

    // Whole crates of each grade collected the day before.
    const wanted: { product: (typeof sellable)[number]; crates: number }[] = [];
    for (const [key, picked] of gradeByKey) {
      const available = (pending.get(key) ?? 0) + (day.grades[key] ?? 0);
      const crates = Math.floor(available / 30);
      pending.set(key, available - crates * 30);
      if (crates > 0) wanted.push({ product: picked, crates });
    }
    if (wanted.length === 0) continue;

    orderNo += 1;
    const order = await db.salesOrder.create({
      data: {
        organisationId: org.id,
        siteId: site.id,
        customerId: buyer.id,
        orderNumber: `SO-2026-${String(orderNo).padStart(4, '0')}`,
        state: 'CONFIRMED',
        orderedOn: onDate,
        wantedOn: onDate,
        drawnFromFlockId: flock.id,
        createdById: owner.id,
        confirmedAt: onDate,
        confirmedById: owner.id,
        lines: {
          create: wanted.map((w) => ({
            productId: w.product.product.id,
            quantity: w.crates,
            unitPricePesewas: PRICE_PER_CRATE[w.product.grade.key] ?? 5400,
            priceBasis: 'LIST',
          })),
        },
      },
      include: { lines: true },
    });

    dispatchNo += 1;
    const dispatch = await db.dispatch.create({
      data: {
        organisationId: org.id,
        siteId: site.id,
        salesOrderId: order.id,
        reference: `DSP-2026-${String(dispatchNo).padStart(4, '0')}`,
        method: buyer.kind === 'WHOLESALE' ? 'COLLECTED' : 'DELIVERED',
        dispatchedOn: onDate,
        takenBy: buyer.kind === 'WHOLESALE' ? buyer.name : 'Farm pickup',
        recordedById: owner.id,
        lines: {
          create: order.lines.map((line) => ({
            salesOrderLineId: line.id,
            productId: line.productId,
            quantity: line.quantity,
            stockMovedBase: line.quantity * 30,
            stockShortfallBase: 0,
          })),
        },
      },
    });

    for (const w of wanted) {
      const itemId = gradeItems.get(w.product.grade.id);
      if (!itemId) continue;
      movementsOut.push({
        itemId,
        stockLocationId: store.id,
        type: 'SALE',
        deltaBase: -(w.crates * 30),
        enteredQuantity: w.crates,
        enteredUomId: crate.id,
        occurredOn: onDate,
        sourceType: 'Dispatch',
        sourceId: dispatch.id,
        recordedById: owner.id,
      });
    }

    const orderValue = order.lines.reduce(
      (sum, l) => sum + l.quantity * l.unitPricePesewas,
      0,
    );

    // Most loads are paid for; some are not yet, so a balance is a real figure
    // on the Money in screen rather than a column of zeros.
    if (next() < 0.85) {
      paymentNo += 1;
      await db.payment.create({
        data: {
          organisationId: org.id,
          customerId: buyer.id,
          reference: `PAY-2026-${String(paymentNo).padStart(4, '0')}`,
          amountPesewas: orderValue,
          method: buyer.kind === 'WHOLESALE' ? 'MOMO' : 'CASH',
          receivedOn: onDate,
          receivedBy: buyer.kind === 'WHOLESALE' ? null : 'Owner',
          externalRef: buyer.kind === 'WHOLESALE' ? `MP${Math.floor(next() * 1e9)}` : null,
          recordedById: owner.id,
        },
      });
    }
  }

  await db.stockMovement.createMany({ data: movementsOut });
  console.log(`  ✓ ${orderNo} orders · ${dispatchNo} loads · ${paymentNo} payments`);

  // --- the wage bill -------------------------------------------------------
  //
  // CHARGED MONTHLY, because that is how it is paid. Labour is the cost most
  // often left out of a farm's figures, and the one that makes a reared pullet
  // look cheaper than it was — so a demo without it would show a cost per egg
  // that flatters the farm.
  //
  // THROUGH AN ALLOCATION, not straight onto the flock. A wage bill is paid by
  // the farm and then divided between whatever flocks were on it; writing it
  // directly onto one flock would skip the division and leave the Costs screen
  // empty, which is exactly what the first version of this did.
  let months = 0;
  for (let age = 30; age <= DAYS; age += 30) {
    const incurredOn = dayAgo(DAYS - age);
    // Two farmhands at roughly GHS 900 a month each.
    const amountPesewas = Math.round(jitter(180000, 0.04, next) / 100) * 100;

    const allocation = await db.costAllocation.create({
      data: {
        organisationId: org.id,
        category: 'LABOUR',
        amountPesewas,
        incurredOn,
        description: 'Monthly wages — two farmhands',
        method: 'EQUAL',
        periodStart: dayAgo(DAYS - age + 29),
        periodEnd: incurredOn,
        recordedById: owner.id,
      },
    });

    // One flock on the farm, so it carries the whole bill.
    await db.flockCostEntry.create({
      data: {
        animalGroupId: flock.id,
        category: 'LABOUR',
        amountPesewas,
        incurredOn,
        description: 'Monthly wages — two farmhands',
        sourceType: 'CostAllocation',
        sourceId: allocation.id,
        allocationId: allocation.id,
        allocationWeight: 1,
        recordedById: owner.id,
      },
    });
    months += 1;
  }
  console.log(`  ✓ ${months} months of wages, allocated to the flock`);

  // --- somebody counted the store ------------------------------------------
  const take = await db.stockTake.create({
    data: {
      organisationId: org.id,
      stockLocationId: store.id,
      reference: 'ST-2026-0001',
      countedOn: dayAgo(14),
      countedById: owner.id,
      notes: 'Monthly count',
    },
  });

  const feedExpected = await db.stockMovement.aggregate({
    where: { itemId: feedItem.id, stockLocationId: store.id, occurredOn: { lte: dayAgo(14) } },
    _sum: { deltaBase: true },
  });
  const expected = Math.round(feedExpected._sum.deltaBase ?? 0);
  // Two bags short, with a reason — the kind of finding a count exists for.
  const counted = expected - 100;
  await db.stockTakeLine.create({
    data: {
      stockTakeId: take.id,
      itemId: feedItem.id,
      countedBase: counted,
      expectedBase: expected,
      varianceBase: counted - expected,
      cause: 'unrecorded_issue',
      note: 'Two bags carried to the house on the Sunday nobody recorded.',
    },
  });
  await db.stockMovement.create({
    data: {
      itemId: feedItem.id,
      stockLocationId: store.id,
      type: 'ADJUSTMENT',
      deltaBase: -100,
      enteredQuantity: -2,
      enteredUomId: kg.id,
      occurredOn: dayAgo(14),
      reasonCode: 'stock_take',
      notes: 'Stock take ST-2026-0001: counted 2 bags short.',
      sourceType: 'StockTake',
      sourceId: take.id,
      recordedById: owner.id,
    },
  });
  console.log('  ✓ One stock take, two bags short, with a reason');

  // --- what it adds up to ---------------------------------------------------
  const population = await db.animalGroupEvent.aggregate({
    where: { animalGroupId: flock.id },
    _sum: { delta: true },
  });
  const eggs = await db.productionRecord.aggregate({
    where: { animalGroupId: flock.id },
    _sum: { countedBase: true },
  });

  console.log(`\n  ${'─'.repeat(70)}`);
  console.log('  The demo farm is ready.');
  console.log(`  ${'─'.repeat(70)}\n`);
  console.log(`  Flock FLK-2026-01 — placed ${PLACED}, now ${population._sum.delta ?? 0} birds`);
  console.log(`  ${Math.round(eggs._sum.countedBase ?? 0).toLocaleString('en-GH')} eggs collected over ${DAYS} days`);
  console.log(`  Sign in and start at the Dashboard, then Report, then the flock itself.\n`);
  console.log('  The "vs standard" columns still read a dash. That is correct: this invented');
  console.log('  a flock\'s history, not a breed\'s standard. Paste the ISA Brown guide in at');
  console.log('  Settings → Breed standards and the comparison appears.\n');
  console.log('  npm run demo:clear   removes all of it\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
