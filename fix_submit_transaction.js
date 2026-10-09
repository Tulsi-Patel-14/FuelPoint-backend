const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, 'src', 'modules', 'worker_app', 'worker_app.controller.ts');
let code = fs.readFileSync(controllerPath, 'utf8');

const newSubmitTransaction = `/**
 * 4. Submit Fuel Transaction
 */
export const submitTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { qrSessionId, customerId, fuelAmount, fuelType, petrolPumpId, idempotencyKey } = req.body;

    const worker = await prisma.workerProfile.findUnique({ where: { userId }, include: { station: true } });
    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    // Resolve Customer by UUID, customId or userId
    let customer = customerId ? await prisma.customerProfile.findFirst({
      where: {
        OR: [
          { id: String(customerId) },
          { customId: String(customerId) },
          { userId: String(customerId) }
        ]
      },
      include: { group: true }
    }) : null;

    // Resolve QR Session by ID or Token
    let qrSession = null;
    if (qrSessionId) {
      qrSession = await prisma.qRSession.findFirst({
        where: {
          OR: [
            { id: String(qrSessionId) },
            { token: String(qrSessionId) }
          ]
        },
        include: { customer: { include: { group: true } } }
      });
    }

    if (!customer && qrSession) {
      customer = qrSession.customer;
    }

    if (!customer) {
      return res.status(400).json({ success: false, message: 'Customer not found.' });
    }

    // Idempotency check: if transaction already processed with this key
    if (idempotencyKey) {
      const existingTx = await prisma.transaction.findFirst({
        where: { idempotencyKey: String(idempotencyKey) },
        include: {
          customer: { select: { fullName: true, vehicle: true, group: true, customId: true } },
          station: { select: { name: true, latitude: true, longitude: true } }
        }
      });
      if (existingTx) {
        const txCustomId = existingTx.customId || formatTransactionId(1);
        const custCustomId = existingTx.customer?.customId || existingTx.customerId;
        return res.status(200).json({
          success: true,
          message: 'Transaction already completed.',
          data: {
            transaction: {
              ...existingTx,
              id: existingTx.id,
              uuid: existingTx.id,
              customId: txCustomId,
              transactionId: txCustomId,
              displayId: txCustomId,
              customerId: custCustomId,
              customerCustomId: custCustomId,
              customerDisplayId: custCustomId,
              customerName: existingTx.customer?.fullName,
              groupName: existingTx.customer?.group?.name || 'Standard Customer',
              petrolPumpName: existingTx.station?.name || 'Downtown City Station'
            }
          }
        });
      }
    }

    const numericFuelAmount = parseFloat(String(fuelAmount || 0));
    if (isNaN(numericFuelAmount) || numericFuelAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid fuel amount.' });
    }

    // Calculate discounts
    const discountPercent = customer.group?.discountPercent || 0;
    const discountAmount = Number(((numericFuelAmount * discountPercent) / 100).toFixed(2));
    const finalAmount = Number((numericFuelAmount - discountAmount).toFixed(2));
    
    const pricePerLitre = fuelType === 'Diesel' ? 90 : fuelType === 'CNG' ? 80 : 100;
    const litres = Number((numericFuelAmount / pricePerLitre).toFixed(2));

    // Ensure a valid station exists
    let validStationId = petrolPumpId || worker.stationId;
    let stationExists = null;
    if (validStationId) {
      stationExists = await prisma.station.findUnique({ where: { id: String(validStationId) } });
    }

    if (!stationExists) {
      let fallbackStation = await prisma.station.findFirst();
      if (!fallbackStation) {
        fallbackStation = await prisma.station.create({
          data: {
            name: 'Downtown City Station',
            latitude: 0,
            longitude: 0,
          }
        });
      }
      validStationId = fallbackStation.id;
    }

    const txCustomId = await generateNextTransactionId(prisma);

    const transaction = await prisma.$transaction(async (tx) => {
      // 1. Create the transaction record
      const newTx = await tx.transaction.create({
        data: {
          customId: txCustomId,
          customerId: customer.id,
          workerId: worker.id,
          stationId: validStationId,
          fuelType: (fuelType as any) || 'Petrol',
          amount: numericFuelAmount,
          discountPercent,
          discountAmount,
          finalAmount,
          litres,
          idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined
        },
        include: {
          customer: { select: { fullName: true, vehicle: true, group: true, customId: true } },
          station: { select: { name: true, latitude: true, longitude: true } }
        }
      });

      // 2. Mark QR session as completely consumed if present
      if (qrSession) {
        await tx.qRSession.update({
          where: { id: qrSession.id },
          data: { status: 'COMPLETED', consumedAt: new Date() }
        }).catch(() => null);
      }

      const workerCode = worker.customId || formatWorkerId(worker.fullName, 1);
      const attendantDisplay = \`\${worker.fullName} (\${workerCode})\`;
      const stationName = newTx.station?.name || 'Downtown City Station';
      const groupName = newTx.customer?.group?.name || 'Standard Customer';
      const custCustomId = customer.customId || customer.id;

      return {
        ...newTx,
        id: newTx.id,
        uuid: newTx.id,
        customId: newTx.customId || txCustomId,
        transactionId: newTx.customId || txCustomId,
        displayId: newTx.customId || txCustomId,
        customerName: newTx.customer?.fullName || customer.fullName,
        customerId: custCustomId,
        customerCustomId: custCustomId,
        customerDisplayId: custCustomId,
        groupName: groupName,
        groupType: 'Standard',
        groupDisplay: \`\${groupName} (Standard)\`,
        petrolPumpName: stationName,
        branchTerminal: stationName,
        attendant: attendantDisplay,
        discountPercentage: discountPercent,
        discountAmount: discountAmount,
        finalAmount: finalAmount,
        collectFromCustomer: finalAmount,
        enteredFuelAmount: numericFuelAmount
      };
    });

    res.status(200).json({
      success: true,
      message: 'Transaction completed successfully.',
      data: { transaction }
    });
  } catch (error: any) {
    console.error('[submitTransaction] Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error: ' + error?.message });
  }
};`;

code = code.replace(/\/\*\*[\s\S]*?\*\/[\s]*export const submitTransaction = async [\s\S]*?^};/m, newSubmitTransaction);

fs.writeFileSync(controllerPath, code, 'utf8');
console.log('Successfully updated submitTransaction in worker_app.controller.ts');
