import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { DumpSize } from '@prisma/client';
import { generatePhotoHash, isValidBase64Image } from '../utils/photoHash';
import { isWithinRadius } from '../utils/geoUtils';

// Validation schemas
const reportDumpSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    photoBase64: z.string().min(100, 'Photo data is required'),
    size: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
    description: z.string().optional(),
});

const GEO_CLUSTER_RADIUS = parseFloat(process.env.GEO_CLUSTER_RADIUS || '100'); // meters
const REPUTATION_PER_VERIFIED = parseInt(process.env.REPUTATION_PER_VERIFIED_DUMP || '10');

/**
 * Submit a dump report (with photo)
 */
export const reportDump = async (req: Request, res: Response) => {
    try {
        const data = reportDumpSchema.parse(req.body);
        const reporterId = req.user!.userId;

        // Validate photo format
        if (!isValidBase64Image(data.photoBase64)) {
            return res.status(400).json({ error: 'Invalid photo format' });
        }

        // Generate photo hash
        const photoHash = generatePhotoHash(data.photoBase64);

        // Check if photo has been used before
        const existingPhoto = await prisma.photoHash.findUnique({
            where: { hash: photoHash },
        });

        if (existingPhoto) {
            return res.status(400).json({
                error: 'Photo already used',
                message: 'This photo has already been submitted. Please take a new photo.'
            });
        }

        // Create dump report and photo hash record
        const report = await prisma.$transaction(async (tx) => {
            // Store photo hash
            await tx.photoHash.create({
                data: {
                    hash: photoHash,
                    uploadedBy: reporterId,
                },
            });

            // Create dump report
            const dumpReport = await tx.dumpReport.create({
                data: {
                    reporterId,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    photoUrl: data.photoBase64, // In production, upload to object storage
                    photoHash,
                    size: data.size as DumpSize,
                    description: data.description,
                    status: 'UNVERIFIED', // Initially unverified
                },
                include: {
                    reporter: {
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
                },
            });

            // Create verification record for the reporter (self)
            await tx.dumpVerification.create({
                data: {
                    dumpReportId: dumpReport.id,
                    verifierId: reporterId,
                },
            });

            // Check for nearby reports from OTHER users
            const nearbyReports = await tx.dumpReport.findMany({
                where: {
                    id: { not: dumpReport.id },
                    reporterId: { not: reporterId }, // Different user
                    status: { in: ['UNVERIFIED', 'VERIFIED'] },
                },
                include: {
                    verifications: true,
                },
            });

            // Find reports within geo-cluster radius
            const clusteredReports = nearbyReports.filter(r =>
                isWithinRadius(
                    data.latitude,
                    data.longitude,
                    r.latitude,
                    r.longitude,
                    GEO_CLUSTER_RADIUS
                )
            );

            // If we find nearby reports, verify them
            if (clusteredReports.length > 0) {
                // Add verification to nearby reports
                for (const nearbyReport of clusteredReports) {
                    // Check if already verified by this user
                    const alreadyVerified = nearbyReport.verifications.some(
                        v => v.verifierId === reporterId
                    );

                    if (!alreadyVerified) {
                        await tx.dumpVerification.create({
                            data: {
                                dumpReportId: nearbyReport.id,
                                verifierId: reporterId,
                            },
                        });

                        // Count verifications
                        const verificationCount = await tx.dumpVerification.count({
                            where: { dumpReportId: nearbyReport.id },
                        });

                        // If ≥2 verifications, mark as VERIFIED
                        if (verificationCount >= 2 && nearbyReport.status === 'UNVERIFIED') {
                            await tx.dumpReport.update({
                                where: { id: nearbyReport.id },
                                data: { status: 'VERIFIED' },
                            });

                            // Award reputation to all verifiers
                            const verifiers = await tx.dumpVerification.findMany({
                                where: { dumpReportId: nearbyReport.id },
                                select: { verifierId: true },
                            });

                            for (const verifier of verifiers) {
                                await tx.reputationScore.upsert({
                                    where: { userId: verifier.verifierId },
                                    create: {
                                        userId: verifier.verifierId,
                                        score: REPUTATION_PER_VERIFIED,
                                        verifiedReports: 1,
                                    },
                                    update: {
                                        score: { increment: REPUTATION_PER_VERIFIED },
                                        verifiedReports: { increment: 1 },
                                    },
                                });
                            }
                        }
                    }
                }

                // Now check if CURRENT report can be verified
                // Add verifications from nearby report creators
                for (const nearbyReport of clusteredReports) {
                    await tx.dumpVerification.create({
                        data: {
                            dumpReportId: dumpReport.id,
                            verifierId: nearbyReport.reporterId,
                        },
                    });
                }

                // Count verifications for current report
                const currentVerificationCount = await tx.dumpVerification.count({
                    where: { dumpReportId: dumpReport.id },
                });

                // If ≥2 verifications, mark as VERIFIED
                if (currentVerificationCount >= 2) {
                    await tx.dumpReport.update({
                        where: { id: dumpReport.id },
                        data: { status: 'VERIFIED' },
                    });

                    // Award reputation to all verifiers
                    const verifiers = await tx.dumpVerification.findMany({
                        where: { dumpReportId: dumpReport.id },
                        select: { verifierId: true },
                    });

                    for (const verifier of verifiers) {
                        await tx.reputationScore.upsert({
                            where: { userId: verifier.verifierId },
                            create: {
                                userId: verifier.verifierId,
                                score: REPUTATION_PER_VERIFIED,
                                verifiedReports: 1,
                            },
                            update: {
                                score: { increment: REPUTATION_PER_VERIFIED },
                                verifiedReports: { increment: 1 },
                            },
                        });
                    }
                }
            }

            return dumpReport;
        });

        // Fetch updated report with verification count
        const updatedReport = await prisma.dumpReport.findUnique({
            where: { id: report.id },
            include: {
                reporter: {
                    select: {
                        phone: true,
                        profile: true,
                    },
                },
                verifications: {
                    include: {
                        verifier: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                    },
                },
            },
        });

        res.status(201).json({
            message: 'Dump report submitted successfully',
            report: updatedReport,
            verificationCount: updatedReport?.verifications.length || 0,
            isVerified: updatedReport?.status === 'VERIFIED',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.errors });
        }
        console.error('Report dump error:', error);
        res.status(500).json({ error: 'Failed to submit report' });
    }
};

/**
 * Get all dump reports
 */
export const getDumps = async (req: Request, res: Response) => {
    try {
        const { status, myReports } = req.query;
        const userId = req.user!.userId;

        let where: any = {};

        // Filter by status
        if (status) {
            where.status = status;
        }

        // Filter to user's own reports
        if (myReports === 'true') {
            where.reporterId = userId;
        }

        const dumps = await prisma.dumpReport.findMany({
            where,
            include: {
                reporter: {
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
                verifications: {
                    include: {
                        verifier: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        verifications: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Remove photo data for list view (too large)
        const dumpsWithoutPhotos = dumps.map(d => ({
            ...d,
            photoUrl: `[${d.photoUrl.length} bytes]`,
        }));

        res.json({ dumps: dumpsWithoutPhotos, count: dumps.length });
    } catch (error) {
        console.error('Get dumps error:', error);
        res.status(500).json({ error: 'Failed to fetch dumps' });
    }
};

/**
 * Get single dump report with full details (including photo)
 */
export const getDumpById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const dump = await prisma.dumpReport.findUnique({
            where: { id },
            include: {
                reporter: {
                    select: {
                        phone: true,
                        profile: true,
                    },
                },
                verifications: {
                    include: {
                        verifier: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                    },
                },
                flags: {
                    include: {
                        flaggedBy: {
                            select: {
                                phone: true,
                                profile: true,
                            },
                        },
                    },
                },
            },
        });

        if (!dump) {
            return res.status(404).json({ error: 'Dump report not found' });
        }

        res.json({ dump });
    } catch (error) {
        console.error('Get dump by ID error:', error);
        res.status(500).json({ error: 'Failed to fetch dump report' });
    }
};

/**
 * Get user reputation score
 */
export const getUserReputation = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;

        const reputation = await prisma.reputationScore.findUnique({
            where: { userId },
        });

        if (!reputation) {
            return res.json({
                score: 0,
                verifiedReports: 0,
                falseReports: 0,
                message: 'No reputation score found',
            });
        }

        res.json({ reputation });
    } catch (error) {
        console.error('Get reputation error:', error);
        res.status(500).json({ error: 'Failed to fetch reputation' });
    }
};
