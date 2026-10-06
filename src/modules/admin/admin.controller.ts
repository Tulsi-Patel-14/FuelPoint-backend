import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: { adminProfile: true }
    });

    if (!user || user.role !== 'ADMIN' || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      data: {
        token: accessToken,
        admin: user.adminProfile
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totalCustomers = await prisma.customerProfile.count();
    const totalWorkers = await prisma.workerProfile.count();
    
    const transactions = await prisma.transaction.aggregate({
      _count: { id: true },
      _sum: { amount: true, discountAmount: true }
    });

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        totalWorkers,
        totalTransactions: transactions._count.id,
        totalRevenue: transactions._sum.amount || 0,
        totalDiscount: transactions._sum.discountAmount || 0,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt((req.query.limit || req.query.pageSize) as string) || 10);
    const isAll = req.query.all === 'true' || req.query.limit === '-1' || req.query.limit === '0';
    const skip = (page - 1) * limit;

    const { search, query: qSearch, q, groupId, status } = req.query;
    const searchTerm = (search || qSearch || q) as string;

    const whereClause: any = { isDeleted: false };

    // 1. Search filter: name, mobile, email, id, vehicle, address
    if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
      const s = searchTerm.trim();
      whereClause.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { id: { contains: s, mode: 'insensitive' } },
        { vehicle: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { user: { mobile: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } }
      ];
    }

    // 2. Group filter
    if (groupId && typeof groupId === 'string' && groupId !== 'all') {
      if (groupId === 'unassigned' || groupId === 'grp-default' || groupId === 'null') {
        whereClause.groupId = null;
      } else {
        whereClause.groupId = groupId;
      }
    }

    // 3. Status filter
    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'OFFLINE'];
    if (status && typeof status === 'string' && status !== 'all') {
      const upperStatus = status.toUpperCase();
      if (validStatuses.includes(upperStatus)) {
        whereClause.user = {
          ...(whereClause.user || {}),
          status: upperStatus
        };
      }
    }

    const [customers, total] = await Promise.all([
      prisma.customerProfile.findMany({
        where: whereClause,
        include: {
          user: true,
          group: true,
          transactions: {
            where: { status: 'COMPLETED' },
            include: { worker: true }
          }
        },
        orderBy: { joinedAt: 'desc' },
        ...(isAll ? {} : { skip, take: limit })
      }),
      prisma.customerProfile.count({ where: whereClause })
    ]);

    const totalPages = isAll ? 1 : (Math.ceil(total / limit) || 1);

    res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        page: isAll ? 1 : page,
        limit: isAll ? total : limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await prisma.workerProfile.findMany({
      where: {
        isDeleted: false
      },
      include: { user: true, station: true }
    });
    res.status(200).json({ success: true, data: workers });
  } catch (error) {
    next(error);
  }
};

export const createWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workerFullName = req.body.fullName || req.body.name;
    const email = req.body.email;
    const mobile = req.body.mobile || req.body.phone;
    const { password, shift, stationId, status } = req.body;

    if (!workerFullName) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
    const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null;

    if (cleanEmail || cleanMobile) {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanMobile ? [{ mobile: cleanMobile }] : [])
          ]
        }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'User with this email or mobile already exists' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    let stationConnect = undefined;
    if (stationId && typeof stationId === 'string' && stationId.trim()) {
      stationConnect = { connect: { id: stationId.trim() } };
    }

    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        mobile: cleanMobile,
        password: hashedPassword,
        role: 'WORKER',
        status: status ? status.toUpperCase() : 'ACTIVE',
        workerProfile: {
          create: {
            fullName: workerFullName,
            shift: shift || 'Morning',
            ...(stationConnect && { station: stationConnect })
          }
        }
      },
      include: {
        workerProfile: {
          include: {
            station: true
          }
        }
      }
    });

    const fullWorker = await prisma.workerProfile.findUnique({
      where: { userId: user.id },
      include: { user: true, station: true }
    });

    res.status(201).json({ success: true, data: fullWorker });
  } catch (error) {
    next(error);
  }
};

export const getWorkerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const worker = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true, station: true }
    });

    if (!worker || worker.isDeleted) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    res.status(200).json({ success: true, data: worker });
  } catch (error) {
    next(error);
  }
};

export const updateWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const workerFullName = req.body.fullName !== undefined ? req.body.fullName : req.body.name;
    const email = req.body.email;
    const mobile = req.body.mobile !== undefined ? req.body.mobile : req.body.phone;
    const { password, shift, stationId, status } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : (email === null ? null : undefined);
    const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : (mobile === null ? null : undefined);

    // Check for email or mobile uniqueness excluding current user
    if (cleanEmail || cleanMobile) {
      const existingUser = await prisma.user.findFirst({
        where: {
          id: { not: workerProfile.userId },
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanMobile ? [{ mobile: cleanMobile }] : [])
          ]
        }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'Email or mobile already in use by another user' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    let stationUpdate = undefined;
    if (stationId !== undefined) {
      if (stationId && typeof stationId === 'string' && stationId.trim()) {
        stationUpdate = { connect: { id: stationId.trim() } };
      } else {
        stationUpdate = { disconnect: true };
      }
    }

    const updatedWorker = await prisma.workerProfile.update({
      where: { id },
      data: {
        fullName: workerFullName !== undefined ? workerFullName : undefined,
        shift: shift !== undefined ? shift : undefined,
        ...(stationUpdate !== undefined && { station: stationUpdate }),
        user: {
          update: {
            ...(cleanEmail !== undefined && { email: cleanEmail }),
            ...(cleanMobile !== undefined && { mobile: cleanMobile }),
            ...(hashedPassword && { password: hashedPassword }),
            ...(status && { status: status.toUpperCase() })
          }
        }
      },
      include: { user: true, station: true }
    });

    res.status(200).json({ success: true, data: updatedWorker });
  } catch (error) {
    console.error("Error in updateWorker:", error);
    next(error);
  }
};

export const deleteWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id }
    });

    if (!workerProfile || workerProfile.isDeleted) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    await prisma.$transaction([
      prisma.workerProfile.update({
        where: { id },
        data: { isDeleted: true }
      }),
      prisma.user.update({
        where: { id: workerProfile.userId },
        data: { status: 'INACTIVE' }
      })
    ]);

    res.status(200).json({ success: true, message: 'Worker deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const transactions = await prisma.transaction.findMany({
      include: { customer: true, worker: true, station: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });
    
    const total = await prisma.transaction.count();

    res.status(200).json({ 
      success: true, 
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await prisma.group.findMany();
    res.status(200).json({ success: true, data: groups });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true }
    });

    if (!user || !user.adminProfile) {
      return res.status(404).json({ success: false, message: 'Admin profile not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        name: user.adminProfile.fullName,
        email: user.email ?? '',
        phone: user.mobile ?? '',
        role: user.role,
        location: user.adminProfile.location ?? '',
        joinedAt: (user as any).createdAt ?? new Date().toISOString(),
        initials: user.adminProfile.fullName
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerFullName = req.body.fullName || req.body.name;
      const email = req.body.email;
      const mobile = req.body.mobile || req.body.phone;
      const { password, vehicle, groupId, address, status } = req.body;
      if (!customerFullName) return res.status(400).json({ success: false, message: 'Full name is required' });

      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
      const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null;

      if (cleanEmail || cleanMobile) {
        const existing = await prisma.user.findFirst({
          where: { OR: [...(cleanEmail ? [{ email: cleanEmail }] : []), ...(cleanMobile ? [{ mobile: cleanMobile }] : [])] }
        });
        if (existing) {
          if (cleanEmail && existing.email === cleanEmail) return res.status(409).json({ success: false, message: 'Email is already in use.' });
          if (cleanMobile && existing.mobile === cleanMobile) return res.status(409).json({ success: false, message: 'Phone number is already in use.' });
        }
      }

      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
      const userStatus = status ? status.toUpperCase() : 'ACTIVE';

      let groupConnect = undefined;
      if (groupId && typeof groupId === 'string' && groupId.trim()) {
        groupConnect = { connect: { id: groupId.trim() } };
      }

      const user = await prisma.user.create({
        data: {
          email: cleanEmail, mobile: cleanMobile, password: hashedPassword, role: 'CUSTOMER', status: userStatus as any,
          customerProfile: {
            create: {
              fullName: customerFullName,
              vehicle: vehicle !== undefined ? vehicle : undefined,
              address: address !== undefined ? address : undefined,
              ...(groupConnect && { group: groupConnect })
            }
          }
        },
        include: { customerProfile: { include: { group: true, user: true } } }
      });
      
      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId: user.id },
        include: { user: true, group: true }
      });

      res.status(201).json({ success: true, data: customerProfile });
    } catch (error) { next(error); }
  };

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const customerFullName = req.body.fullName !== undefined ? req.body.fullName : req.body.name;
      const email = req.body.email;
      const mobile = req.body.mobile !== undefined ? req.body.mobile : req.body.phone;
      const { password, vehicle, groupId, address, status } = req.body;

      const profile = await prisma.customerProfile.findUnique({ where: { id }, include: { user: true } });
      if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });

      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : (email === null ? null : undefined);
      const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : (mobile === null ? null : undefined);

      if (cleanEmail || cleanMobile) {
        const existing = await prisma.user.findFirst({
          where: { 
            id: { not: profile.userId },
            OR: [...(cleanEmail ? [{ email: cleanEmail }] : []), ...(cleanMobile ? [{ mobile: cleanMobile }] : [])] 
          }
        });
        if (existing) {
          if (cleanEmail && existing.email === cleanEmail) return res.status(409).json({ success: false, message: 'Email is already in use.' });
          if (cleanMobile && existing.mobile === cleanMobile) return res.status(409).json({ success: false, message: 'Phone number is already in use.' });
        }
      }

      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
      const userStatus = status ? status.toUpperCase() : undefined;

      let groupUpdate = undefined;
      if (groupId !== undefined) {
        if (groupId && typeof groupId === 'string' && groupId.trim()) {
          groupUpdate = { connect: { id: groupId.trim() } };
        } else {
          groupUpdate = { disconnect: true };
        }
      }

      const updated = await prisma.customerProfile.update({
        where: { id },
        data: {
          fullName: customerFullName !== undefined ? customerFullName : undefined,
          vehicle: vehicle !== undefined ? vehicle : undefined,
          address: address !== undefined ? address : undefined,
          ...(groupUpdate !== undefined && { group: groupUpdate }),
          user: { update: { ...(cleanEmail !== undefined && { email: cleanEmail }), ...(cleanMobile !== undefined && { mobile: cleanMobile }), ...(hashedPassword && { password: hashedPassword }), ...(userStatus && { status: userStatus as any }) } }
        },
        include: { user: true, group: true }
      });
      res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
  };

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const profile = await prisma.customerProfile.findUnique({ where: { id } });
      if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });
      await prisma.$transaction([
        prisma.customerProfile.update({ where: { id }, data: { isDeleted: true } }),
        prisma.user.update({ where: { id: profile.userId }, data: { status: 'INACTIVE' } })
      ]);
      res.status(200).json({ success: true, message: 'Customer deleted' });
    } catch (error) { next(error); }
  };

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, discountPercent, description, isDefault } = req.body;
    const group = await prisma.group.create({ data: { name, discountPercent, description, isDefault } });
    res.status(201).json({ success: true, data: group });
  } catch (error) { next(error); }
};

export const updateGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, discountPercent, description, isDefault, active } = req.body;
    const group = await prisma.group.update({
      where: { id }, data: { name, discountPercent, description, isDefault, active }
    });
    res.status(200).json({ success: true, data: group });
  } catch (error) { next(error); }
};

export const toggleGroupActive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const updated = await prisma.group.update({ where: { id }, data: { active: !group.active } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const deleteGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await prisma.group.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Group deleted' });
  } catch (error) { next(error); }
};

export const markNotificationRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    // ensure notification belongs to user or is global
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (notif.userId && notif.userId !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });

    const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const markAllNotificationsRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    // update all for this user, OR global if allowed, but safest is to scope to user
    await prisma.notification.updateMany({ 
      where: { OR: [{ userId }, { userId: null }] }, 
      data: { read: true } 
    });
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) { next(error); }
};
