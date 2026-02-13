import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { WasteType } from '@prisma/client';

// Validation schemas
const declareWasteSchema = z.object({
    wasteType: z.enum(['PET', 'ALUMINUM', 'HDPE']),
    estimatedKg: z.number().positive('Weight must be positive'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    description: z.string().optional(),
});

const pickupSchema = z.object({
    notes: z.string().optional(),
});

const validateSchema = z.object({
    confirmedKg: z.number().positive('Weight must be positive'),
    notes: z.string().optional(),
});

// Price per kg by waste type (from env or defaults)
const getPricePerKg = (wasteType: WasteType): number => {
    switch (wasteType) {
        case 'PET':
            return parseFloat(process.env.PRICE_PET_PER_KG || '500');
        case 'ALUMINUM':
            return parseFloat(process.env.PRICE_ALUMINUM_PER_KG || '800');
        case 'HDPE':
            return parseFloat(process.env.PRICE_HDPE_PER_KG || '600');
        default:
            return 0;
    }
};

/**
 * CITIZEN: Declare waste for collection
 */
export const declareWaste = async (req: Request, res: Response) => {
    try {
        const data = declareWasteSchema.parse(req.body);
        const userId = req.user!.userId;

        const declaration = await prisma.wasteDeclaration.create({
            data: {
                citizenId: userId,
                wasteType: data.wasteType as WasteType,
                estimatedKg: data.estimatedKg,
                latitude: data.latitude,
                longitude: data.longitude,
                description: data.description,
                status: 'PENDING',
            },
            include: {
                citizen: {
                    select: {
                        id: true,
                        phone: true,
                        profile: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
            },
        });

        res.status(201).json({
            message: 'Waste declaration created successfully',
            declaration,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Declare waste error:', error);
        res.status(500).json({ error: 'Failed to create declaration' });
    }
};

/**
 * COLLECTOR: Confirm pickup of declared waste
 */
export const confirmPickup = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const data = pickupSchema.parse(req.body);
        const collectorId = req.user!.userId;

        // Find declaration
        const declaration = await prisma.wasteDeclaration.findUnique({
            where: { id },
        });

        if (!declaration) {
            return res.status(404).json({ error: 'Declaration not found' });
        }

        if (declaration.status !== 'PENDING') {
            return res.status(400).json({
                error: 'Invalid status',
                message: 'Only PENDING declarations can be picked up'
            });
        }

        // Create collection record and update declaration status
        const collection = await prisma.$transaction(async (tx) => {
            const coll = await tx.collection.create({
                data: {
                    declarationId: id,
                    collectorId,
                    notes: data.notes,
                },
            });

            await tx.wasteDeclaration.update({
                where: { id },
                data: { status: 'PICKED_UP' },
            });

            return coll;
        });

        res.json({
            message: 'Pickup confirmed successfully',
            collection,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Confirm pickup error:', error);
        res.status(500).json({ error: 'Failed to confirm pickup' });
    }
};

/**
 * AGENCY: Validate weight and create transaction
 */
export const validateWeight = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const data = validateSchema.parse(req.body);
        const agencyId = req.user!.userId;

        // Find declaration
        const declaration = await prisma.wasteDeclaration.findUnique({
            where: { id },
            include: {
                collection: true,
            },
        });

        if (!declaration) {
            return res.status(404).json({ error: 'Declaration not found' });
        }

        if (declaration.status !== 'PICKED_UP') {
            return res.status(400).json({
                error: 'Invalid status',
                message: 'Only PICKED_UP declarations can be validated'
            });
        }

        if (!declaration.collection) {
            return res.status(400).json({ error: 'No collection record found' });
        }

        const collectorId = declaration.collection.collectorId;
        const citizenId = declaration.citizenId;

        // Calculate payment split
        const pricePerKg = getPricePerKg(declaration.wasteType);
        const totalValue = data.confirmedKg * pricePerKg;

        const collectorPercentage = parseFloat(process.env.COLLECTOR_PERCENTAGE || '50');
        const citizenPercentage = parseFloat(process.env.CITIZEN_PERCENTAGE || '20');
        const citylinkPercentage = parseFloat(process.env.CITYLINK_PERCENTAGE || '30');

        const collectorAmount = (totalValue * collectorPercentage) / 100;
        const citizenAmount = (totalValue * citizenPercentage) / 100;
        const citylinkAmount = (totalValue * citylinkPercentage) / 100;

        // Create confirmation, transaction, and update wallets
        const result = await prisma.$transaction(async (tx) => {
            // Create agency confirmation
            const confirmation = await tx.agencyConfirmation.create({
                data: {
                    declarationId: id,
                    agencyId,
                    confirmedKg: data.confirmedKg,
                    pricePerKg,
                    totalValue,
                    notes: data.notes,
                },
            });

            // Create recycling transaction
            const transaction = await tx.recyclingTransaction.create({
                data: {
                    declarationId: id,
                    totalAmount: totalValue,
                    collectorAmount,
                    citizenAmount,
                    citylinkAmount,
                },
            });

            // Update collector wallet
            await tx.wallet.upsert({
                where: { userId: collectorId },
                create: {
                    userId: collectorId,
                    balance: collectorAmount,
                },
                update: {
                    balance: {
                        increment: collectorAmount,
                    },
                },
            });

            // Update citizen wallet
            await tx.wallet.upsert({
                where: { userId: citizenId },
                create: {
                    userId: citizenId,
                    balance: citizenAmount,
                },
                update: {
                    balance: {
                        increment: citizenAmount,
                    },
                },
            });

            // Update declaration status
            await tx.wasteDeclaration.update({
                where: { id },
                data: { status: 'COMPLETED' },
            });

            return { confirmation, transaction };
        });

        res.json({
            message: 'Weight validated and transaction created successfully',
            ...result,
            breakdown: {
                totalValue,
                collectorAmount,
                citizenAmount,
                citylinkAmount,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Validate weight error:', error);
        res.status(500).json({ error: 'Failed to validate weight' });
    }
};

/**
 * Get all waste declarations (filtered by role)
 */
export const getDeclarations = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const role = req.user!.role;
        const { status } = req.query;

        let where: any = {};

        // Filter by role
        if (role === 'CITIZEN') {
            where.citizenId = userId;
        } else if (role === 'COLLECTOR') {
            // Collectors see all PENDING declarations or their own pickups
            if (status === 'PENDING') {
                where.status = 'PENDING';
            } else {
                where.collection = {
                    collectorId: userId,
                };
            }
        }

        // Filter by status if provided
        if (status && role !== 'COLLECTOR') {
            where.status = status;
        }

        const declarations = await prisma.wasteDeclaration.findMany({
            where,
            include: {
                citizen: {
                    select: {
                        phone: true,
                        profile: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
                collection: {
                    include: {
                        collector: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                    },
                },
                agencyConfirmation: true,
                recyclingTransaction: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.json({ declarations, count: declarations.length });
    } catch (error) {
        console.error('Get declarations error:', error);
        res.status(500).json({ error: 'Failed to fetch declarations' });
    }
};

/**
 * Get user wallet balance
 */
export const getWallet = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;

        const wallet = await prisma.wallet.findUnique({
            where: { userId },
        });

        if (!wallet) {
            return res.json({ balance: 0, message: 'No wallet found' });
        }

        res.json({ wallet });
    } catch (error) {
        console.error('Get wallet error:', error);
        res.status(500).json({ error: 'Failed to fetch wallet' });
    }
};

/**
 * Get recycling transactions
 */
export const getTransactions = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const role = req.user!.role;

        // Get transactions where user is either citizen or collector
        const transactions = await prisma.recyclingTransaction.findMany({
            where: {
                declaration: {
                    OR: [
                        { citizenId: userId },
                        { collection: { collectorId: userId } },
                    ],
                },
            },
            include: {
                declaration: {
                    include: {
                        citizen: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                        collection: {
                            include: {
                                collector: {
                                    select: {
                                        phone: true,
                                        profile: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.json({ transactions, count: transactions.length });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};
