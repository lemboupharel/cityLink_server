import { Router } from 'express';
import {
    declareWaste,
    confirmPickup,
    validateWeight,
    getDeclarations,
    getWallet,
    getTransactions,
} from '../controllers/recycling.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/recycling/declare
 * @desc    Citizen declares waste for collection
 * @access  CITIZEN only
 */
router.post('/declare', requireRole('CITIZEN'), declareWaste);

/**
 * @route   POST /api/recycling/pickup/:id
 * @desc    Collector confirms pickup of declared waste
 * @access  COLLECTOR only
 */
router.post('/pickup/:id', requireRole('COLLECTOR'), confirmPickup);

/**
 * @route   POST /api/recycling/validate/:id
 * @desc    Agency validates weight and creates transaction
 * @access  AGENCY only
 */
router.post('/validate/:id', requireRole('AGENCY'), validateWeight);

/**
 * @route   GET /api/recycling/declarations
 * @desc    Get waste declarations (filtered by role)
 * @access  CITIZEN, COLLECTOR, AGENCY
 */
router.get('/declarations', requireRole('CITIZEN', 'COLLECTOR', 'AGENCY'), getDeclarations);

/**
 * @route   GET /api/recycling/wallet
 * @desc    Get user wallet balance
 * @access  CITIZEN, COLLECTOR
 */
router.get('/wallet', requireRole('CITIZEN', 'COLLECTOR'), getWallet);

/**
 * @route   GET /api/recycling/transactions
 * @desc    Get recycling transactions
 * @access  CITIZEN, COLLECTOR
 */
router.get('/transactions', requireRole('CITIZEN', 'COLLECTOR'), getTransactions);

export default router;
