import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();

const parseDateRange = (startDate?: any, endDate?: any) => {
  let start: Date;
  let end: Date;

  if (startDate) {
    if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      start = new Date(`${startDate}T00:00:00.000Z`);
    } else {
      start = new Date(startDate);
    }
    if (isNaN(start.getTime())) {
      start = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
      start.setUTCHours(0, 0, 0, 0);
    }
  } else {
    start = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    start.setUTCHours(0, 0, 0, 0);
  }

  if (endDate) {
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      end = new Date(`${endDate}T23:59:59.999Z`);
    } else {
      end = new Date(endDate);
    }
    if (isNaN(end.getTime())) {
      end = new Date();
      end.setUTCHours(23, 59, 59, 999);
    }
  } else {
    end = new Date();
    end.setUTCHours(23, 59, 59, 999);
  }

  return { start, end };
};

export const getReportSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, end } = parseDateRange(startDate, endDate);

    const [
      periodTxnsAgg,
      discountedScansCount,
      newRegistrationsCount,
      totalCustomersCount,
      activeCustomersCount,
      defaultGroup,
      totalWorkersCount,
      activeWorkersCount,
      totalGroupsCount,
      activeGroupsCount,
      allCustomersForGroups
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        },
        _count: { id: true },
        _sum: {
          amount: true,
          litres: true,
          discountAmount: true
        }
      }),
      prisma.transaction.count({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end },
          discountAmount: { gt: 0 }
        }
      }),
      prisma.customerProfile.count({
        where: {
          isDeleted: false,
          joinedAt: { gte: start, lte: end }
        }
      }),
      prisma.customerProfile.count({
        where: { isDeleted: false }
      }),
      prisma.customerProfile.count({
        where: { isDeleted: false, user: { status: 'ACTIVE' } }
      }),
      prisma.group.findFirst({
        where: { isDeleted: false, isDefault: true }
      }),
      prisma.workerProfile.count({
        where: { isDeleted: false }
      }),
      prisma.workerProfile.count({
        where: { isDeleted: false, user: { status: 'ACTIVE' } }
      }),
      prisma.group.count({
        where: { isDeleted: false }
      }),
      prisma.group.count({
        where: { isDeleted: false, active: true }
      }),
      prisma.customerProfile.findMany({
        where: { isDeleted: false },
        select: { groupId: true }
      })
    ]);

    const defaultGroupId = defaultGroup?.id || 'default-group';
    const unassignedCount = allCustomersForGroups.filter(
      c => !c.groupId || c.groupId === defaultGroupId || c.groupId === 'default-group'
    ).length;
    const groupedCustomersCount = allCustomersForGroups.filter(
      c => c.groupId && c.groupId !== defaultGroupId && c.groupId !== 'default-group'
    ).length;

    const txnsCount = periodTxnsAgg._count.id || 0;
    const revenue = periodTxnsAgg._sum.amount || 0;
    const litres = Math.round(periodTxnsAgg._sum.litres || 0);
    const avgTicket = txnsCount > 0 ? Math.round(revenue / txnsCount) : 0;
    const discountTotal = periodTxnsAgg._sum.discountAmount || 0;
    const effectiveRate = revenue > 0 ? Number(((discountTotal / revenue) * 100).toFixed(2)) : 0;
    const avgDiscountPerScan = txnsCount > 0 ? Math.round(discountTotal / txnsCount) : 0;

    res.status(200).json({
      success: true,
      data: {
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        transactions: {
          transactions: txnsCount,
          revenue,
          litresDispensed: litres,
          avgTicket,
        },
        discount: {
          discountGiven: discountTotal,
          effectiveRate,
          discountedScans: discountedScansCount,
          avgDiscountPerScan,
        },
        customers: {
          newRegistrations: newRegistrationsCount,
          totalCustomers: totalCustomersCount,
          active: activeCustomersCount,
          unassigned: unassignedCount,
        },
        workers: {
          workers: totalWorkersCount,
          active: activeWorkersCount,
          scansInRange: txnsCount,
          discountProcessed: discountTotal,
        },
        groups: {
          groups: totalGroupsCount,
          activeGroups: activeGroupsCount,
          groupDiscount: discountTotal,
          groupedCustomers: groupedCustomersCount,
        },
        scansInRange: txnsCount,
        registrationsInRange: newRegistrationsCount,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getReportData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category = 'transactions', startDate, endDate } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt((req.query.limit || req.query.pageSize) as string) || 10);
    const skip = (page - 1) * limit;

    const { start, end } = parseDateRange(startDate, endDate);

    if (category === 'transactions' || category === 'discount') {
      const where: any = {
        status: 'COMPLETED',
        createdAt: { gte: start, lte: end }
      };

      const [txns, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include: {
            customer: { select: { id: true, fullName: true, groupId: true } },
            worker: { select: { id: true, fullName: true } },
            station: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.transaction.count({ where })
      ]);

      const data = txns.map(t => ({
        id: t.id,
        customerId: t.customerId,
        customerName: t.customer?.fullName || "Customer",
        workerId: t.workerId,
        workerName: t.worker?.fullName || "Worker",
        groupId: t.customer?.groupId || "default-group",
        fuel: t.fuelType || "Petrol",
        litres: t.litres || 0,
        amount: t.amount || 0,
        discountPercent: t.discountPercent || 0,
        discountAmount: t.discountAmount || 0,
        createdAt: t.createdAt.toISOString(),
      }));

      return res.status(200).json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        }
      });
    }

    if (category === 'customers') {
      const where: any = {
        isDeleted: false,
        joinedAt: { gte: start, lte: end },
      };

      const [customers, total] = await Promise.all([
        prisma.customerProfile.findMany({
          where,
          include: {
            user: { select: { id: true, status: true, mobile: true, email: true } },
            group: { select: { id: true, name: true } },
            transactions: {
              where: { status: 'COMPLETED' },
              select: { id: true, amount: true, discountAmount: true, finalAmount: true }
            }
          },
          orderBy: { joinedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.customerProfile.count({ where })
      ]);

      const data = customers.map(c => ({
        id: c.id,
        name: c.fullName,
        phone: c.user?.mobile || "",
        email: c.user?.email || "",
        groupId: c.groupId || "default-group",
        groupName: c.group?.name || "Unassigned",
        registeredAt: c.joinedAt.toISOString(),
        transactions: c.transactions.length,
        discountReceived: c.transactions.reduce((s, t) => s + (t.discountAmount || 0), 0),
        status: (c.user?.status?.toLowerCase() || 'active'),
      }));

      return res.status(200).json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        }
      });
    }

    if (category === 'workers') {
      const where: any = { isDeleted: false };

      const [workers, total] = await Promise.all([
        prisma.workerProfile.findMany({
          where,
          include: {
            user: { select: { id: true, status: true, mobile: true, email: true } },
            station: { select: { id: true, name: true } },
            transactions: {
              where: { status: 'COMPLETED' },
              select: { id: true, amount: true, discountAmount: true, createdAt: true }
            }
          },
          orderBy: { joinedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.workerProfile.count({ where })
      ]);

      const data = workers.map(w => {
        const txns = w.transactions || [];
        const discount = txns.reduce((s, t) => s + (t.discountAmount || 0), 0);
        let lastAct = w.joinedAt.toISOString();
        if (txns.length > 0) {
          const sorted = [...txns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          lastAct = sorted[0].createdAt.toISOString();
        }
        return {
          id: w.id,
          name: w.fullName,
          status: (w.user?.status?.toLowerCase() || 'active'),
          scans: Math.max(w.scans || 0, txns.length),
          transactions: txns.length,
          discountProcessed: discount,
          lastActivity: lastAct,
        };
      });

      return res.status(200).json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        }
      });
    }

    if (category === 'groups') {
      const where: any = { isDeleted: false };

      const [groups, total] = await Promise.all([
        prisma.group.findMany({
          where,
          include: {
            customers: {
              where: { isDeleted: false },
              select: {
                id: true,
                transactions: {
                  where: { status: 'COMPLETED' },
                  select: { id: true, amount: true, discountAmount: true }
                }
              }
            }
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: limit,
        }),
        prisma.group.count({ where })
      ]);

      const data = groups.map(g => {
        let txnsCount = 0;
        let discGen = 0;
        for (const c of g.customers) {
          txnsCount += c.transactions.length;
          for (const t of c.transactions) {
            discGen += (t.discountAmount || 0);
          }
        }
        return {
          id: g.id,
          name: g.name,
          discountPercent: g.discountPercent,
          customers: g.customers.length,
          transactions: txnsCount,
          discountGenerated: discGen,
        };
      });

      return res.status(200).json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        }
      });
    }

    return res.status(400).json({ success: false, message: `Invalid category: ${category}` });
  } catch (error) {
    next(error);
  }
};

export const exportReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category = 'transactions', startDate, endDate, format = 'csv' } = req.query;
    const { start, end } = parseDateRange(startDate, endDate);

    let headers: { key: string; label: string; width?: number }[] = [];
    let rows: Record<string, any>[] = [];

    if (category === 'transactions' || category === 'discount') {
      const txns = await prisma.transaction.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        },
        include: {
          customer: { select: { fullName: true } },
          worker: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' }
      });

      headers = [
        { key: 'id', label: 'Transaction ID', width: 36 },
        { key: 'date', label: 'Date', width: 22 },
        { key: 'customer', label: 'Customer', width: 22 },
        { key: 'worker', label: 'Worker', width: 22 },
        { key: 'fuel', label: 'Fuel', width: 12 },
        { key: 'litres', label: 'Litres', width: 12 },
        { key: 'amount', label: 'Amount (INR)', width: 16 },
        { key: 'discountPercent', label: 'Discount %', width: 14 },
        { key: 'discountAmount', label: 'Discount (INR)', width: 16 },
      ];

      rows = txns.map(t => ({
        id: t.id,
        date: new Date(t.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
        customer: t.customer?.fullName || 'Customer',
        worker: t.worker?.fullName || 'Worker',
        fuel: t.fuelType || 'Petrol',
        litres: t.litres || 0,
        amount: t.amount || 0,
        discountPercent: `${t.discountPercent || 0}%`,
        discountAmount: t.discountAmount || 0,
      }));
    } else if (category === 'customers') {
      const customers = await prisma.customerProfile.findMany({
        where: {
          isDeleted: false,
          joinedAt: { gte: start, lte: end }
        },
        include: {
          user: { select: { mobile: true, email: true, status: true } },
          group: { select: { name: true } },
          transactions: {
            where: { status: 'COMPLETED' },
            select: { discountAmount: true }
          }
        },
        orderBy: { joinedAt: 'desc' }
      });

      headers = [
        { key: 'id', label: 'Customer ID', width: 36 },
        { key: 'name', label: 'Customer Name', width: 24 },
        { key: 'phone', label: 'Phone', width: 16 },
        { key: 'email', label: 'Email', width: 24 },
        { key: 'group', label: 'Group', width: 20 },
        { key: 'registered', label: 'Registered Date', width: 20 },
        { key: 'transactions', label: 'Total Transactions', width: 18 },
        { key: 'discount', label: 'Discount Received (INR)', width: 22 },
        { key: 'status', label: 'Status', width: 14 },
      ];

      rows = customers.map(c => ({
        id: c.id,
        name: c.fullName,
        phone: c.user?.mobile || '',
        email: c.user?.email || '',
        group: c.group?.name || 'Unassigned',
        registered: new Date(c.joinedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }),
        transactions: c.transactions.length,
        discount: c.transactions.reduce((s, t) => s + (t.discountAmount || 0), 0),
        status: c.user?.status || 'ACTIVE',
      }));
    } else if (category === 'workers') {
      const workers = await prisma.workerProfile.findMany({
        where: { isDeleted: false },
        include: {
          user: { select: { mobile: true, email: true, status: true } },
          transactions: {
            where: { status: 'COMPLETED' },
            select: { discountAmount: true, createdAt: true }
          }
        },
        orderBy: { joinedAt: 'desc' }
      });

      headers = [
        { key: 'id', label: 'Worker ID', width: 36 },
        { key: 'name', label: 'Worker Name', width: 24 },
        { key: 'phone', label: 'Phone', width: 16 },
        { key: 'status', label: 'Status', width: 14 },
        { key: 'scans', label: 'Total Scans', width: 14 },
        { key: 'transactions', label: 'Total Transactions', width: 18 },
        { key: 'discount', label: 'Discount Processed (INR)', width: 22 },
        { key: 'lastActivity', label: 'Last Activity', width: 20 },
      ];

      rows = workers.map(w => {
        const txns = w.transactions || [];
        const discount = txns.reduce((s, t) => s + (t.discountAmount || 0), 0);
        let lastAct = new Date(w.joinedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' });
        if (txns.length > 0) {
          const sorted = [...txns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          lastAct = new Date(sorted[0].createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' });
        }
        return {
          id: w.id,
          name: w.fullName,
          phone: w.user?.mobile || '',
          status: w.user?.status || 'ACTIVE',
          scans: Math.max(w.scans || 0, txns.length),
          transactions: txns.length,
          discount,
          lastActivity: lastAct,
        };
      });
    } else if (category === 'groups') {
      const groups = await prisma.group.findMany({
        where: { isDeleted: false },
        include: {
          customers: {
            where: { isDeleted: false },
            select: {
              transactions: {
                where: { status: 'COMPLETED' },
                select: { discountAmount: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      headers = [
        { key: 'name', label: 'Group Name', width: 24 },
        { key: 'discountPercent', label: 'Discount %', width: 14 },
        { key: 'customers', label: 'Total Customers', width: 16 },
        { key: 'transactions', label: 'Total Transactions', width: 18 },
        { key: 'discountGenerated', label: 'Discount Generated (INR)', width: 22 },
      ];

      rows = groups.map(g => {
        let txnsCount = 0;
        let discGen = 0;
        for (const c of g.customers) {
          txnsCount += c.transactions.length;
          for (const t of c.transactions) {
            discGen += (t.discountAmount || 0);
          }
        }
        return {
          name: g.name,
          discountPercent: `${g.discountPercent}%`,
          customers: g.customers.length,
          transactions: txnsCount,
          discountGenerated: discGen,
        };
      });
    }

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Nothing to export for this range.' });
    }

    const isExcel = String(format).toLowerCase() === 'excel' || String(format).toLowerCase() === 'xlsx';
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (isExcel) {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'FuelPoint Admin';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet(`${String(category).toUpperCase()} Report`);
      worksheet.columns = headers.map(h => ({
        header: h.label,
        key: h.key,
        width: h.width || 20,
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0284C7' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 24;

      for (const row of rows) {
        worksheet.addRow(row);
      }

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.alignment = { vertical: 'middle' };
        }
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${category}-report-${dateStamp}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    } else {
      // CSV format
      const headerLine = headers.map(h => `"${h.label.replace(/"/g, '""')}"`).join(',');
      const bodyLines = rows.map(r =>
        headers.map(h => {
          const val = r[h.key] ?? '';
          const str = String(val);
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : `"${str}"`;
        }).join(',')
      );
      const csvContent = [headerLine, ...bodyLines].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${category}-report-${dateStamp}.csv"`);
      return res.status(200).send(csvContent);
    }
  } catch (error) {
    next(error);
  }
};
