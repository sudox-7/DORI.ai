const routerHandler = (req, res, next) => {
  res.status(404).json({
    message: "Invalid route",
    route: req.url,
  });
};

export default routerHandler;