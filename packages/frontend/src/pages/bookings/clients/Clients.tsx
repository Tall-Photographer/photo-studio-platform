// packages/frontend/src/pages/clients/Clients.tsx
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Badge,
  Drawer,
  Stack,
  Divider,
  FormControlLabel,
  Checkbox,
  Slider,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  FilterList as FilterIcon,
  MoreVert as MoreVertIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  Star as StarIcon,
  LocalOffer as TagIcon,
  TrendingUp as TrendingUpIcon,
  Groups as GroupsIcon,
  AttachMoney as MoneyIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Merge as MergeIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useDebounce } from 'use-debounce';

import { useGetClientsQuery, useExportClientsMutation } from '../../store/api/clientApi';
import { useGetClientInsightsQuery } from '../../store/api/reportApi';
import CreateClientDialog from '../../components/clients/CreateClientDialog';
import ImportClientsDialog from '../../components/clients/ImportClientsDialog';
import MergeClientsDialog from '../../components/clients/MergeClientsDialog';
import ClientQuickView from '../../components/clients/ClientQuickView';
import StatsCard from '../../components/common/StatsCard';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useAppSelector } from '../../hooks/redux';

export default function Clients() {
  const navigate = useNavigate();
  const { studio } = useAppSelector((state) => state.auth);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  
  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  // Filters
  const [filters, setFilters] = useState({
    tags: [] as string[],
    minBookings: undefined as number | undefined,
    maxBookings: undefined as number | undefined,
    minSpent: undefined as number | undefined,
    maxSpent: undefined as number | undefined,
    hasMarketingConsent: undefined as boolean | undefined,
    isVip: undefined as boolean | undefined,
    source: '',
  });

  // API calls
  const { data, isLoading } = useGetClientsQuery({
    page: page + 1,
    limit: rowsPerPage,
    search: debouncedSearch,
    ...filters,
  });

  const { data: insights } = useGetClientInsightsQuery();
  const [exportClients] = useExportClientsMutation();

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, clientId: string) => {
    setAnchorEl(event.currentTarget);
    setSelectedClientId(clientId);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedClientId(null);
  };

  const handleExport = async (format: 'csv' | 'excel') => {
    try {
      const result = await exportClients({ format, ...filters }).unwrap();
      // Handle file download
      const blob = new Blob([result.data], {
        type: format === 'csv' ? 'text/csv' : 'application/vnd.ms-excel',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clients_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export clients:', error);
    }
  };

  const handleQuickView = (clientId: string) => {
    setSelectedClient(clientId);
    setQuickViewOpen(true);
    handleMenuClose();
  };

  const handleEdit = (clientId: string) => {
    navigate(`/clients/${clientId}`);
    handleMenuClose();
  };

  const handleViewBookings = (clientId: string) => {
    navigate(`/bookings?clientId=${clientId}`);
    handleMenuClose();
  };

  const applyFilters = (newFilters: typeof filters) => {
    setFilters(newFilters);
    setFilterDrawerOpen(false);
    setPage(0);
  };

  const resetFilters = () => {
    setFilters({
      tags: [],
      minBookings: undefined,
      maxBookings: undefined,
      minSpent: undefined,
      maxSpent: undefined,
      hasMarketingConsent: undefined,
      isVip: undefined,
      source: '',
    });
  };

  const activeFilterCount = Object.values(filters).filter(
    (value) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
  ).length;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Clients
        </Typography>
        
        {/* Stats Cards */}
        {insights && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Total Clients"
                value={insights.totalClients}
                icon={<GroupsIcon />}
                trend={insights.monthlyGrowth[0]?.count > insights.monthlyGrowth[1]?.count ? 'up' : 'down'}
                trendValue={`${Math.abs(
                  ((insights.monthlyGrowth[0]?.count - insights.monthlyGrowth[1]?.count) /
                    insights.monthlyGrowth[1]?.count) * 100
                ).toFixed(1)}%`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Active Clients"
                value={insights.activeClients}
                subtitle="Last 6 months"
                icon={<TrendingUpIcon />}
                color="success"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="VIP Clients"
                value={insights.vipClients}
                icon={<StarIcon />}
                color="warning"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Avg. Booking Value"
                value={formatCurrency(insights.averageBookingValue, studio?.defaultCurrency)}
                icon={<MoneyIcon />}
                color="info"
              />
            </Grid>
          </Grid>
        )}

        {/* Actions Bar */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ flexGrow: 1, maxWidth: 400 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Add Client
          </Button>
          
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setImportDialogOpen(true)}
          >
            Import
          </Button>
          
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => handleExport('csv')}
          >
            Export
          </Button>
          
          <Button
            variant="outlined"
            startIcon={<MergeIcon />}
            onClick={() => setMergeDialogOpen(true)}
          >
            Merge
          </Button>
          
          <IconButton
            onClick={() => setFilterDrawerOpen(true)}
            color={activeFilterCount > 0 ? 'primary' : 'default'}
          >
            <Badge badgeContent={activeFilterCount} color="primary">
              <FilterIcon />
            </Badge>
          </IconButton>
        </Box>
      </Box>

      {/* Clients Table */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Client</TableCell>
                  <TableCell>Contact</TableCell>
                  <TableCell>Bookings</TableCell>
                  <TableCell>Total Spent</TableCell>
                  <TableCell>Last Booking</TableCell>
                  <TableCell>Tags</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : data?.clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      No clients found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.clients.map((client) => (
                    <TableRow
                      key={client.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar sx={{ bgcolor: 'primary.main' }}>
                            {client.firstName[0]}{client.lastName[0]}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" fontWeight={500}>
                              {client.firstName} {client.lastName}
                              {client.isVip && (
                                <Tooltip title="VIP Client">
                                  <StarIcon
                                    sx={{
                                      fontSize: 16,
                                      color: 'warning.main',
                                      verticalAlign: 'middle',
                                      ml: 0.5,
                                    }}
                                  />
                                </Tooltip>
                              )}
                            </Typography>
                            {client.company && (
                              <Typography variant="caption" color="text.secondary">
                                <BusinessIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                                {client.company}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <EmailIcon sx={{ fontSize: 16 }} />
                            {client.email}
                          </Typography>
                          {client.phone && (
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PhoneIcon sx={{ fontSize: 16 }} />
                              {client.phone}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      
                      <TableCell>
                        <Typography variant="body2">
                          {client._count.bookings}
                        </Typography>
                      </TableCell>
                      
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {formatCurrency(client.totalSpent, studio?.defaultCurrency)}
                        </Typography>
                      </TableCell>
                      
                      <TableCell>
                        <Typography variant="body2">
                          {client.bookings[0]
                            ? formatDate(client.bookings[0].startDateTime)
                            : 'Never'}
                        </Typography>
                      </TableCell>
                      
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {client.tags.slice(0, 3).map((tag) => (
                            <Chip key={tag} label={tag} size="small" />
                          ))}
                          {client.tags.length > 3 && (
                            <Chip label={`+${client.tags.length - 3}`} size="small" variant="outlined" />
                          )}
                        </Box>
                      </TableCell>
                      
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {client.marketingConsent && (
                            <Tooltip title="Marketing consent given">
                              <EmailIcon sx={{ fontSize: 18, color: 'success.main' }} />
                            </Tooltip>
                          )}
                          {client.portalEnabled && (
                            <Tooltip title="Portal access enabled">
                              <PersonIcon sx={{ fontSize: 18, color: 'info.main' }} />
                            </Tooltip>
                          )}
                          {client.loyaltyPoints > 0 && (
                            <Tooltip title={`${client.loyaltyPoints} loyalty points`}>
                              <Badge badgeContent={client.loyaltyPoints} color="secondary" max={999}>
                                <StarIcon sx={{ fontSize: 18, color: 'secondary.main' }} />
                              </Badge>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMenuOpen(e, client.id);
                          }}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          
          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={data?.pagination.total || 0}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </CardContent>
      </Card>

      {/* Action Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => handleQuickView(selectedClientId!)}>
          Quick View
        </MenuItem>
        <MenuItem onClick={() => handleEdit(selectedClientId!)}>
          Edit Details
        </MenuItem>
        <MenuItem onClick={() => handleViewBookings(selectedClientId!)}>
          View Bookings
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => navigate(`/invoices?clientId=${selectedClientId}`)}>
          View Invoices
        </MenuItem>
        <MenuItem onClick={() => navigate(`/projects?clientId=${selectedClientId}`)}>
          View Projects
        </MenuItem>
      </Menu>

      {/* Filter Drawer */}
      <Drawer
        anchor="right"
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
      >
        <Box sx={{ width: 350, p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Filter Clients
          </Typography>
          
          <Stack spacing={3}>
            <FormControl fullWidth>
              <InputLabel>Source</InputLabel>
              <Select
                value={filters.source}
                onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                label="Source"
              >
                <MenuItem value="">All Sources</MenuItem>
                <MenuItem value="website">Website</MenuItem>
                <MenuItem value="referral">Referral</MenuItem>
                <MenuItem value="social_media">Social Media</MenuItem>
                <MenuItem value="google">Google</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            <Box>
              <Typography gutterBottom>Booking Count</Typography>
              <Box sx={{ px: 2 }}>
                <Slider
                  value={[filters.minBookings || 0, filters.maxBookings || 50]}
                  onChange={(e, value) => {
                    const [min, max] = value as number[];
                    setFilters({
                      ...filters,
                      minBookings: min > 0 ? min : undefined,
                      maxBookings: max < 50 ? max : undefined,
                    });
                  }}
                  valueLabelDisplay="auto"
                  min={0}
                  max={50}
                />
              </Box>
            </Box>

            <Box>
              <Typography gutterBottom>Total Spent</Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Min"
                  type="number"
                  size="small"
                  value={filters.minSpent || ''}
                  onChange={(e) => setFilters({
                    ...filters,
                    minSpent: e.target.value ? Number(e.target.value) : undefined,
                  })}
                />
                <TextField
                  label="Max"
                  type="number"
                  size="small"
                  value={filters.maxSpent || ''}
                  onChange={(e) => setFilters({
                    ...filters,
                    maxSpent: e.target.value ? Number(e.target.value) : undefined,
                  })}
                />
              </Stack>
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={filters.hasMarketingConsent === true}
                  indeterminate={filters.hasMarketingConsent === undefined}
                  onChange={(e) => {
                    if (filters.hasMarketingConsent === undefined) {
                      setFilters({ ...filters, hasMarketingConsent: true });
                    } else if (filters.hasMarketingConsent === true) {
                      setFilters({ ...filters, hasMarketingConsent: false });
                    } else {
                      setFilters({ ...filters, hasMarketingConsent: undefined });
                    }
                  }}
                />
              }
              label="Marketing Consent"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={filters.isVip === true}
                  indeterminate={filters.isVip === undefined}
                  onChange={(e) => {
                    if (filters.isVip === undefined) {
                      setFilters({ ...filters, isVip: true });
                    } else if (filters.isVip === true) {
                      setFilters({ ...filters, isVip: false });
                    } else {
                      setFilters({ ...filters, isVip: undefined });
                    }
                  }}
                />
              }
              label="VIP Clients"
            />

            <Divider />

            <Stack direction="row" spacing={2}>
              <Button
                fullWidth
                variant="outlined"
                onClick={resetFilters}
              >
                Reset
              </Button>
              <Button
                fullWidth
                variant="contained"
                onClick={() => applyFilters(filters)}
              >
                Apply
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Drawer>

      {/* Dialogs */}
      <CreateClientDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
      
      <ImportClientsDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
      />
      
      <MergeClientsDialog
        open={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
      />
      
      {selectedClient && (
        <ClientQuickView
          clientId={selectedClient}
          open={quickViewOpen}
          onClose={() => {
            setQuickViewOpen(false);
            setSelectedClient(null);
          }}
        />
      )}
    </Box>
  );
}